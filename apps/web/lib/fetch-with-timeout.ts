/**
 * Timed `fetch` wrapper — production-readiness review surfaced (P0)
 * that no external fetch in `apps/web/lib/clients.ts` had a timeout,
 * so any stall by DMIRS / Landgate / Sentinel-Hub / Esri would
 * exhaust the request worker pool with no upper bound on wall time.
 *
 * Usage:
 *
 *     import { fetchWithTimeout, FetchTimeoutError } from "@/lib/fetch-with-timeout";
 *
 *     try {
 *       const res = await fetchWithTimeout(
 *         "https://services.slip.wa.gov.au/...",
 *         { method: "GET" },
 *         { timeoutMs: 5_000, label: "slip.cadastre" },
 *       );
 *       // ...
 *     } catch (err) {
 *       if (err instanceof FetchTimeoutError) {
 *         // serve stale-or-explain; emit `degraded.upstream` log event
 *       }
 *       throw err;
 *     }
 *
 * The wrapper preserves the standard `fetch` signature so existing
 * call sites migrate by a single import + name swap.
 */

const DEFAULT_TIMEOUT_MS = 5_000;

export class FetchTimeoutError extends Error {
  public readonly url: string;
  public readonly timeoutMs: number;
  public readonly label: string | undefined;
  public constructor(url: string, timeoutMs: number, label?: string) {
    super(
      `fetch timeout after ${timeoutMs}ms: ${label ? `[${label}] ` : ""}${url}`,
    );
    this.name = "FetchTimeoutError";
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.label = label;
  }
}

export type FetchWithTimeoutOptions = {
  /** Hard deadline in milliseconds. Default 5 000. */
  readonly timeoutMs?: number;
  /**
   * Label written into error messages and (later) into the structured
   * log line — pick a stable identifier per upstream (e.g.
   * `"slip.cadastre"`, `"dmirs.tenements"`, `"sentinel.exportImage"`)
   * so a 3am operator can grep one upstream's failure stream.
   */
  readonly label?: string;
};

/**
 * Drop-in `fetch` with a hard timeout. Cancels via `AbortController`,
 * which means the connection is actually released — not just the
 * Promise abandoned with the socket still open.
 *
 * If the caller passes their own `signal`, it composes with the
 * timeout: whichever fires first wins. The thrown error type is
 * still {@link FetchTimeoutError} for the timeout path, and the
 * caller's signal's `reason` (DOMException) for the user-cancel path.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS, label }: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  // Compose caller's signal with our timeout, if present.
  if (init.signal) {
    const callerSignal = init.signal;
    if (callerSignal.aborted) {
      clearTimeout(timer);
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener(
        "abort",
        () => {
          if (!timedOut) controller.abort(callerSignal.reason);
        },
        { once: true },
      );
    }
  }

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      throw new FetchTimeoutError(url, timeoutMs, label);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Structured logger (pino) for apps/web.
 *
 * Output:
 * - JSON to stdout, with pretty-printing in dev when `pino-pretty` is
 *   available; production callers should leave the default JSON path.
 * - AU timezone in human-facing `auTime` field; ISO `time` field is the
 *   machine-readable timestamp pino emits by default.
 * - Sensitive keys/headers are redacted on the boundary — see SECURITY.md
 *   for the redaction policy and OBSERVABILITY.md for log destinations.
 * - Use `logger.child({ scope: "..." })` (or `scoped(name)`) to add a
 *   route/tool scope. Use the `error` field on `warn` and above so the
 *   log analyser can index errors as a first-class column.
 *
 * Environment variables:
 *
 *   LOG_LEVEL          — trace | debug | info | warn | error | fatal
 *                        Defaults: "debug" in dev/test, "info" in
 *                        production.
 *
 *   RA_LOG_SHIP        — "true" to enable production shipping mode.
 *                        Logs are written as one-line JSON to stdout
 *                        (which a sidecar log collector — BetterStack /
 *                        Sumo / CloudWatch agent — tails). See
 *                        internal/OBSERVABILITY.md for destinations.
 *
 *   RA_PINO_TRANSPORT  — "pretty" | "json" | "<path>"
 *                        Production hook. "pretty" forces the pretty
 *                        transport even in prod (useful in containers
 *                        with an interactive shell). "json" forces the
 *                        default JSON-to-stdout path (default in prod).
 *                        A filesystem path routes through pino's `file`
 *                        transport — log-shipping sidecars can tail the
 *                        file rather than the process stdout.
 *
 * IMPORTANT: child processes that speak MCP over stdout (e.g. adapter-demo)
 * MUST NOT use this default destination — pipe to fd 2 instead. See
 * packages/adapter-demo for the stderr-bound child logger.
 */

import pino, { type Logger, type LoggerOptions } from "pino";

const REDACT_PATHS: readonly string[] = [
  "password",
  "*.password",
  "token",
  "*.token",
  "apiKey",
  "*.apiKey",
  "email",
  "*.email",
  "phone",
  "*.phone",
  "abn",
  "*.abn",
  "headers.authorization",
  "headers.Authorization",
  "headers.cookie",
  "headers.Cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "request.headers.authorization",
  "request.headers.cookie",
];

const isDev =
  process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test";

/**
 * Explicit log levels supported. We re-export the union so callers (route
 * handlers, runbooks, alert rules) can refer to it by name rather than
 * sprinkling string literals.
 */
export type LogLevel =
  | "trace"
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "fatal";

const VALID_LEVELS: readonly LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

function resolveLevel(): LogLevel {
  const requested = process.env.LOG_LEVEL?.toLowerCase();
  if (
    requested !== undefined &&
    (VALID_LEVELS as readonly string[]).includes(requested)
  ) {
    return requested as LogLevel;
  }
  return isDev ? "debug" : "info";
}

/**
 * Ship-to-log-collector mode. When `RA_LOG_SHIP=true`, the logger emits
 * one JSON object per line to stdout so a sidecar agent (BetterStack
 * Logtail, Sumo Logic Collector, CloudWatch Agent) can tail and ship it.
 * Pretty-printing is force-disabled in this mode regardless of NODE_ENV
 * so dev sessions running against a real collector don't break the
 * collector's JSON parser.
 */
const shipToCollector = process.env.RA_LOG_SHIP === "true";

/**
 * Production transport override. See header doc. We deliberately do not
 * try to discover collectors at runtime — the only correct thing to do
 * in a server process is emit JSON and let an agent take it away.
 */
const transportPreference = (process.env.RA_PINO_TRANSPORT ?? "").trim();

const baseOptions: LoggerOptions = {
  level: resolveLevel(),
  base: {
    service: "ratesassist-web",
    env: process.env.NODE_ENV ?? "development",
  },
  timestamp: (): string => {
    // AU timezone (Australia/Sydney) for human-readable `auTime`,
    // alongside the ISO `time` field pino emits by default.
    const now = new Date();
    const auTime = now.toLocaleString("en-AU", {
      timeZone: "Australia/Sydney",
      hour12: false,
    });
    return `,"time":"${now.toISOString()}","auTime":"${auTime}"`;
  },
  redact: {
    paths: [...REDACT_PATHS],
    censor: "[REDACTED]",
    remove: false,
  },
  formatters: {
    level: (label: string): { level: string } => ({ level: label }),
  },
  /**
   * Serialise Error instances on the `error` field into a structured
   * payload (type / message / stack / cause) so log analysers can index
   * `error.type` and `error.message` directly. Callers should pass
   * `{ error: err }` to `logger.warn` and above; the legacy pattern of
   * stringifying the message into the message body is preserved but no
   * longer required.
   */
  serializers: {
    error: errorSerializer,
    err: errorSerializer, // pino's default field name
  },
};

function errorSerializer(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      type: value.name,
      message: value.message,
      stack: value.stack,
    };
    if ((value as { code?: unknown }).code !== undefined) {
      out.code = (value as { code?: unknown }).code;
    }
    if (value.cause !== undefined) {
      try {
        out.cause = errorSerializer(value.cause);
      } catch {
        out.cause = String(value.cause);
      }
    }
    return out;
  }
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  return { message: String(value) };
}

function shouldUsePretty(): boolean {
  if (transportPreference === "json") return false;
  if (transportPreference === "pretty") return true;
  if (shipToCollector) return false;
  return isDev;
}

function makeLogger(): Logger {
  // RA_PINO_TRANSPORT=/path/to/file — route through pino's file
  // transport. Sidecar agents tail the file rather than the process
  // stdout. Useful in environments (e.g. some CloudWatch agent setups)
  // where stdout capture is unreliable.
  if (
    transportPreference !== "" &&
    transportPreference !== "json" &&
    transportPreference !== "pretty"
  ) {
    try {
      return pino({
        ...baseOptions,
        transport: {
          target: "pino/file",
          options: { destination: transportPreference, mkdir: true },
        },
      });
    } catch {
      // Fall through to JSON-to-stdout if the path target fails.
    }
  }

  if (shouldUsePretty()) {
    try {
      return pino({
        ...baseOptions,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        },
      });
    } catch {
      // pino-pretty optional — fall through to JSON.
    }
  }
  return pino(baseOptions);
}

export const logger: Logger = makeLogger();

/**
 * Convenience: create a child logger with a scope tag. Use a stable
 * scope name (route path, MCP tool id) so log queries can filter on it.
 */
export function scoped(scope: string, extra: Record<string, unknown> = {}): Logger {
  return logger.child({ scope, ...extra });
}

/**
 * Whether the logger is currently in ship-to-collector mode. Route
 * handlers can branch on this for behaviours that only make sense in
 * production (e.g. emitting a redacted audit row on every request).
 */
export function isShippingLogs(): boolean {
  return shipToCollector;
}

export type { Logger } from "pino";

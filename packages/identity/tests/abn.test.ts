/**
 * Characterization tests for createAbnClient.
 *
 * Pin every behavioural distinction the legacy bug-fix introduced:
 *   - GUID configured + live ok → source: "ato"
 *   - GUID configured + 503 then 200 → retry, success
 *   - No GUID + known ABN + non-strict → source: "mock"
 *   - No GUID + unknown ABN + non-strict → unconfigured (the recently fixed bug)
 *   - Strict + no GUID → unconfigured
 *   - Cache: second call returns source: "cache"
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createAbnClient } from "../src/abn.js";

function abrJsonResponse(body: object): Response {
  return new Response(`callback(${JSON.stringify(body)});`, {
    status: 200,
    headers: { "content-type": "text/javascript" },
  });
}

describe("createAbnClient", () => {
  beforeEach(() => {
    // Reset module cache between tests by constructing a fresh client.
  });

  it("strict + no GUID → ok:false unconfigured", async () => {
    const fetcher = vi.fn();
    const client = createAbnClient({ strict: true, fetcher });
    client.__resetCacheForTests();

    const r = await client.lookupAbn("32614882110");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("unconfigured");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("strict + GUID + live ok → ok:true source:ato", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      abrJsonResponse({
        Abn: "32614882110",
        AbnStatus: "Active",
        EntityName: "Pilbara Iron Holdings Pty Ltd",
        EntityTypeName: "Australian Private Company",
        Gst: "Y",
        GstFromDate: "2014-08-19",
        AddressState: "WA",
        AddressPostcode: "6000",
      }),
    );
    const client = createAbnClient({
      strict: true,
      guid: "test-guid",
      fetcher,
    });
    client.__resetCacheForTests();

    const r = await client.lookupAbn("32614882110");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("ato");
      expect(r.entityName).toBe("Pilbara Iron Holdings Pty Ltd");
      expect(r.status).toBe("Active");
      expect(r.gstRegistered).toBe(true);
      expect(r.abn).toBe("32 614 882 110");
    }
  });

  it("non-strict + no GUID + ABN in MOCK_ENTRIES → ok:true source:mock", async () => {
    const fetcher = vi.fn();
    const client = createAbnClient({ strict: false, fetcher });
    client.__resetCacheForTests();

    const r = await client.lookupAbn("32614882110");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("mock");
      expect(r.entityName).toBe("Pilbara Iron Holdings Pty Ltd");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("non-strict + unknown ABN + no GUID → ok:false unconfigured (bug pinned)", async () => {
    const fetcher = vi.fn();
    const client = createAbnClient({ strict: false, fetcher });
    client.__resetCacheForTests();

    const r = await client.lookupAbn("99999999999");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("unconfigured");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries on 503 then succeeds: two fetch attempts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(
        abrJsonResponse({
          Abn: "44990221005",
          AbnStatus: "Active",
          EntityName: "Karratha Exploration Pty Ltd",
          Gst: "",
        }),
      );

    const client = createAbnClient({
      strict: true,
      guid: "g",
      timeoutMs: 1_000,
      fetcher,
    });
    client.__resetCacheForTests();

    // Override the retry backoff path by intercepting setTimeout:
    // The library uses RETRY_BACKOFF_MS = 1500. Use vi.useFakeTimers
    // to keep the test fast.
    vi.useFakeTimers();
    const promise = client.lookupAbn("44990221005");
    // Allow the first fetch to resolve, then advance through the 1.5s sleep.
    await vi.advanceTimersByTimeAsync(2_000);
    const r = await promise;
    vi.useRealTimers();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.source).toBe("ato");
      expect(r.entityName).toBe("Karratha Exploration Pty Ltd");
      expect(r.gstRegistered).toBe(false);
    }
  });

  it("cache: second call same ABN returns source:cache without refetch", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      abrJsonResponse({
        Abn: "18552117884",
        AbnStatus: "Active",
        EntityName: "Goldfields Resources Ltd",
        Gst: "Y",
      }),
    );
    const client = createAbnClient({
      strict: true,
      guid: "g",
      fetcher,
    });
    client.__resetCacheForTests();

    const r1 = await client.lookupAbn("18552117884");
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.source).toBe("ato");

    const r2 = await client.lookupAbn("18552117884");
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.source).toBe("cache");

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("invalid ABN (not 11 digits) → ok:false invalid_input without fetching", async () => {
    const fetcher = vi.fn();
    const client = createAbnClient({ strict: true, guid: "g", fetcher });
    client.__resetCacheForTests();

    const r = await client.lookupAbn("12345");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("invalid_input");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("ABR not_found code → ok:false not_found", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(
      abrJsonResponse({ AbnStatus: "0000000003" }),
    );
    const client = createAbnClient({ strict: true, guid: "g", fetcher });
    client.__resetCacheForTests();

    const r = await client.lookupAbn("12345678901");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("not_found");
  });
});

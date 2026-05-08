// ATO ABN Lookup integration.
// Public web API: https://abr.business.gov.au/json/AbnDetails.aspx?abn=...&guid=...
// Free, but requires a GUID for production traffic. For demo, we use the public
// free endpoint and fall back to a deterministic mock if unavailable.

const ABN_LOOKUP_BASE =
  process.env.ABN_LOOKUP_BASE ?? "https://abr.business.gov.au/json";
const ABN_LOOKUP_GUID = process.env.ABN_LOOKUP_GUID ?? "";

export type AbnLookupResult =
  | {
      ok: true;
      abn: string;
      entityName: string;
      entityType?: string;
      status: "Active" | "Cancelled" | "Unknown";
      gstRegistered: boolean;
      gstRegisteredFrom?: string;
      address?: string;
      source: "ato" | "mock";
    }
  | { ok: false; error: string };

// Deterministic mock for offline / no-GUID operation
const MOCK: Record<string, Omit<Extract<AbnLookupResult, { ok: true }>, "source">> = {
  "32614882110": {
    ok: true,
    abn: "32 614 882 110",
    entityName: "Pilbara Iron Holdings Pty Ltd",
    entityType: "Australian Private Company",
    status: "Active",
    gstRegistered: true,
    gstRegisteredFrom: "2014-08-19",
    address: "Level 12, 100 St Georges Terrace, Perth WA 6000",
  },
  "44990221005": {
    ok: true,
    abn: "44 990 221 005",
    entityName: "Karratha Exploration Pty Ltd",
    entityType: "Australian Private Company",
    status: "Active",
    gstRegistered: true,
    gstRegisteredFrom: "2022-11-14",
    address: "PO Box 5511, Karratha WA 6714",
  },
  "18552117884": {
    ok: true,
    abn: "18 552 117 884",
    entityName: "Goldfields Resources Ltd",
    entityType: "Australian Public Company",
    status: "Active",
    gstRegistered: true,
    gstRegisteredFrom: "2009-06-22",
    address: "Level 5, 50 Kings Park Road, West Perth WA 6005",
  },
};

function normaliseAbn(abn: string): string {
  return String(abn).replace(/\s+/g, "").replace(/-/g, "");
}

export async function lookupAbn(abn: string): Promise<AbnLookupResult> {
  const clean = normaliseAbn(abn);
  if (!/^\d{11}$/.test(clean)) {
    return { ok: false, error: "ABN must be 11 digits" };
  }

  // Live ABN Lookup if GUID present
  if (ABN_LOOKUP_GUID) {
    try {
      const url = `${ABN_LOOKUP_BASE}/AbnDetails.aspx?abn=${clean}&guid=${ABN_LOOKUP_GUID}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // ATO returns JSONP-ish wrapped response — strip wrapper
      const json = JSON.parse(text.replace(/^callback\(/, "").replace(/\);?$/, ""));
      if (json.AbnStatus === "0000000003") {
        return { ok: false, error: "ABN not found" };
      }
      return {
        ok: true,
        abn: clean.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4"),
        entityName: json.EntityName ?? "Unknown",
        entityType: json.EntityTypeName,
        status: (json.AbnStatus ?? "Unknown") as "Active" | "Cancelled" | "Unknown",
        gstRegistered: !!json.Gst,
        gstRegisteredFrom: json.GstFromDate,
        address: json.AddressPostcode
          ? `${json.AddressState ?? ""} ${json.AddressPostcode}`.trim()
          : undefined,
        source: "ato",
      };
    } catch (e: unknown) {
      // Fall through to mock
    }
  }

  const mock = MOCK[clean];
  if (mock) {
    return { ...mock, source: "mock" };
  }
  return {
    ok: true,
    abn: clean.replace(/(\d{2})(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4"),
    entityName: "Unknown entity (no GUID configured for live lookup)",
    status: "Unknown",
    gstRegistered: false,
    source: "mock",
  };
}

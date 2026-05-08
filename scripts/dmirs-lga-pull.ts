/**
 * scripts/dmirs-lga-pull.ts — Real DMIRS-via-SLIP pull for a single WA LGA.
 *
 * Pulls live mining tenement features from SLIP across an LGA's bounding box
 * (tiled to respect the spatial package's per-call area cap) and emits a
 * sales-ready Markdown report listing every tenement-covered parcel as a
 * speculative review candidate, grouped by holder, type, status, and age.
 *
 * Usage:
 *   tsx scripts/dmirs-lga-pull.ts --lga "City of Karratha" [--out report.md]
 *                                 [--bbox-buffer-km 0] [--cache-dir .dmirs-cache]
 *                                 [--max-tenements 1000] [--fresh]
 *
 * Honest source labelling: the report header records pull timestamp + bbox.
 * No mock fallback. If SLIP is unreachable we fail loudly (non-zero exit).
 *
 * Read-only against external services. Writes only to cache dir + output path.
 */

import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { createHash } from "node:crypto";

import { fetchSlipFeatures } from "@ratesassist/spatial/slip";
import type { BoundingBox } from "@ratesassist/contract";
import type { GeoJsonFeature } from "@ratesassist/spatial";

// ===== CLI parsing =====

type Args = {
  lga: string;
  out?: string;
  cacheDir: string;
  maxTenements: number;
  bboxBufferKm: number;
  fresh: boolean;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Partial<Args> = {
    cacheDir: ".dmirs-cache",
    maxTenements: 1000,
    bboxBufferKm: 0,
    fresh: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--lga": args.lga = next(); break;
      case "--out": args.out = next(); break;
      case "--cache-dir": args.cacheDir = next(); break;
      case "--max-tenements": args.maxTenements = Number(next()); break;
      case "--bbox-buffer-km": args.bboxBufferKm = Number(next()); break;
      case "--fresh": args.fresh = true; break;
      case "-h":
      case "--help":
        printHelp();
        process.exit(0);
      default: throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!args.lga) {
    printHelp();
    throw new Error("--lga is required");
  }
  return args as Args;
}

function printHelp(): void {
  console.log(`Usage: tsx scripts/dmirs-lga-pull.ts --lga "City of Karratha" [options]

Options:
  --lga <name>          LGA name (case-insensitive substring match)
  --out <path>          Output report path (default: ./reports/<slug>-<date>.md)
  --cache-dir <path>    Cache dir (default: .dmirs-cache)
  --max-tenements <n>   Hard cap on total features pulled (default: 1000)
  --bbox-buffer-km <n>  Extend the LGA bbox by N km on each side (default: 0)
  --fresh               Bypass cache and re-fetch
`);
}

// ===== Helpers =====

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function bboxKey(bbox: BoundingBox): string {
  return createHash("sha1").update(bbox.map((n) => n.toFixed(4)).join(",")).digest("hex").slice(0, 12);
}

/**
 * Convert a km buffer to (dLng, dLat) at a reference latitude. Approximate;
 * fine at WA latitudes for the purpose of widening a bbox by a few km.
 */
function kmToDeg(km: number, refLatDeg: number): { dLng: number; dLat: number } {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((refLatDeg * Math.PI) / 180));
  return { dLng, dLat };
}

// ===== LGA bbox lookup =====

/**
 * SLIP Local Government Authority boundary layer. Probed inline (not added to
 * SLIP_LAYERS) per the diff-scope constraint. Service tree:
 *   https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Boundaries/MapServer
 *
 * The candidate list is tried in order. WA's LGA layer has historically lived
 * at index 1 ("Local Government Authority Boundaries"); 2/3 are fallbacks.
 */
const LGA_SERVICE_URL =
  "https://services.slip.wa.gov.au/public/rest/services/SLIP_Public_Services/Boundaries/MapServer";
// Layer 14 = "Local Government Authority (LGA) Boundaries (LGATE-233)" verified
// live against the published service capabilities. Other indices are kept as
// fallbacks in case SLIP renumbers.
const LGA_CANDIDATE_LAYERS = [14, 17, 1, 0];

type LgaMatch = {
  layerId: number;
  attrName: string;
  bbox: BoundingBox;
  rawName: string;
};

/**
 * Query the LGA boundary layer for features whose name matches the supplied
 * substring (case-insensitive). Returns the first matching feature's bbox.
 *
 * Uses raw fetch here because SLIP_LAYERS does not (yet) include this layer
 * and we are not modifying packages/spatial. Once verified live it can be
 * promoted into SLIP_LAYERS in a follow-up.
 */
async function findLgaBbox(lgaName: string, signal?: AbortSignal): Promise<LgaMatch> {
  // Names of name-bearing fields seen on WA boundary layers across versions.
  const NAME_FIELDS = ["name", "LGA_LABEL", "LGA_NAME", "LGANAME", "NAME", "AUTH_NAME"];
  const lowered = lgaName.toLowerCase();

  let lastError = "";
  // Try a few WHERE-clause shapes — different ArcGIS deployments expose
  // different SQL dialects (file-geodatabase vs SDE), so UPPER() is not
  // universally supported.
  const safe = lgaName.replace(/'/g, "''");
  const whereVariants = [
    (f: string) => `UPPER(${f}) LIKE UPPER('%${safe}%')`,
    (f: string) => `${f} LIKE '%${safe}%'`,
    (f: string) => `${f} = '${safe}'`,
  ];
  for (const layerId of LGA_CANDIDATE_LAYERS) {
    for (const field of NAME_FIELDS) {
     for (const whereFn of whereVariants) {
      const where = encodeURIComponent(whereFn(field));
      const url =
        `${LGA_SERVICE_URL}/${layerId}/query` +
        `?where=${where}` +
        `&outFields=*` +
        `&returnGeometry=false` +
        `&returnExtentOnly=false` +
        `&f=json` +
        `&resultRecordCount=10`;
      try {
        const res = await fetch(url, { signal });
        if (!res.ok) { lastError = `layer ${layerId}/${field}: HTTP ${res.status}`; continue; }
        const json: unknown = await res.json();
        const obj = json as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: { message?: string } };
        if (obj.error) { lastError = `layer ${layerId}/${field}: ${obj.error.message ?? "ArcGIS error"}`; continue; }
        if (!Array.isArray(obj.features) || obj.features.length === 0) continue;

        // Pick the feature whose name field most-closely matches.
        const feat = obj.features.find((f) => {
          const v = f.attributes?.[field];
          return typeof v === "string" && v.toLowerCase().includes(lowered);
        }) ?? obj.features[0];
        const rawName = String(feat?.attributes?.[field] ?? lgaName);

        // Now fetch the bbox via returnExtentOnly to keep the payload small.
        const extentUrl =
          `${LGA_SERVICE_URL}/${layerId}/query` +
          `?where=${where}` +
          `&returnExtentOnly=true` +
          `&outSR=4326` +
          `&f=json`;
        const extRes = await fetch(extentUrl, { signal });
        if (!extRes.ok) { lastError = `extent layer ${layerId}: HTTP ${extRes.status}`; continue; }
        const extJson = await extRes.json() as { extent?: { xmin: number; ymin: number; xmax: number; ymax: number } };
        if (!extJson.extent) { lastError = `layer ${layerId}: no extent in response`; continue; }
        const { xmin, ymin, xmax, ymax } = extJson.extent;
        if (![xmin, ymin, xmax, ymax].every((n) => Number.isFinite(n))) {
          lastError = `layer ${layerId}: non-finite extent`;
          continue;
        }
        return {
          layerId,
          attrName: field,
          bbox: [xmin, ymin, xmax, ymax],
          rawName,
        };
      } catch (e) {
        lastError = `layer ${layerId}/${field}: ${(e as Error).message}`;
      }
     }
    }
  }
  throw new Error(`SLIP LGA layer probe failed; last error: ${lastError || "no match"}`);
}

// ===== bbox tiling =====

/**
 * The SLIP fetcher caps bbox area at 1.0 sq deg. WA mining LGAs (e.g. East
 * Pilbara at >370k km^2) far exceed that, so we tile the LGA bbox into
 * roughly 0.8x0.8-deg cells and union the results.
 */
const TILE_DEG = 0.8;

function tileBbox(bbox: BoundingBox): BoundingBox[] {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const tiles: BoundingBox[] = [];
  for (let lng = minLng; lng < maxLng; lng += TILE_DEG) {
    for (let lat = minLat; lat < maxLat; lat += TILE_DEG) {
      tiles.push([
        lng,
        lat,
        Math.min(lng + TILE_DEG, maxLng),
        Math.min(lat + TILE_DEG, maxLat),
      ]);
    }
  }
  return tiles;
}

// ===== Tenement pull (cached, tiled) =====

type CachedTile = {
  bbox: BoundingBox;
  queriedAt: string;
  features: GeoJsonFeature[];
};

async function pullTenements(
  bbox: BoundingBox,
  cacheDir: string,
  fresh: boolean,
  maxTotal: number,
  signal?: AbortSignal,
): Promise<{ features: GeoJsonFeature[]; tilesQueried: number; cacheHits: number; queriedAt: string }> {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const tiles = tileBbox(bbox);
  const all: GeoJsonFeature[] = [];
  const seen = new Set<string>();
  let cacheHits = 0;
  let tilesQueried = 0;
  const earliest = new Date().toISOString();

  for (const tile of tiles) {
    if (all.length >= maxTotal) break;
    const cachePath = join(cacheDir, `mining-tenements-${bboxKey(tile)}.json`);
    let tileFeatures: GeoJsonFeature[] | null = null;

    if (!fresh && existsSync(cachePath)) {
      try {
        const raw = readFileSync(cachePath, "utf8");
        const parsed = JSON.parse(raw) as CachedTile;
        if (Array.isArray(parsed.features)) {
          tileFeatures = parsed.features;
          cacheHits++;
        }
      } catch {
        // corrupt cache — re-fetch
      }
    }

    if (tileFeatures === null) {
      const result = await fetchSlipFeatures("miningTenements", tile, {
        maxFeatures: Math.min(2000, maxTotal),
        timeoutMs: 20_000,
        signal,
        correlationId: `dmirs-lga-pull-${bboxKey(tile)}`,
      });
      tilesQueried++;
      if (!result.ok) {
        // Hard fail: SLIP unreachable. No mock fallback.
        throw new Error(
          `SLIP unreachable for tile ${tile.join(",")}: ${result.code}: ${result.error}`,
        );
      }
      tileFeatures = [...result.features];
      try {
        writeFileSync(
          cachePath,
          JSON.stringify(
            {
              bbox: tile,
              queriedAt: result.queriedAt,
              features: tileFeatures,
            } satisfies CachedTile,
            null,
            2,
          ),
        );
      } catch {
        // Cache write failure is non-fatal.
      }
    }

    for (const feat of tileFeatures) {
      // Dedup by tenement ID across overlapping tiles.
      const id = pickTenementId(feat) ?? JSON.stringify(feat.properties).slice(0, 64);
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(feat);
      if (all.length >= maxTotal) break;
    }
  }

  return { features: all, tilesQueried, cacheHits, queriedAt: earliest };
}

// ===== Synthesis =====

type Tenement = {
  id: string;
  type: string; // M, E, P, G, L, ?
  status: string;
  holder: string;
  granted?: string;
  raw: Record<string, unknown>;
};

// Field names verified against the live DMIRS-003 layer (Aug 2024 schema).
// Lowercased here; lookup is case-insensitive.
const ID_FIELDS = ["fmt_tenid", "tenid", "TENID", "TENEMENT_ID", "FMT_TENID"];
const HOLDER_FIELDS = ["holder1", "HOLDER1", "HOLDERS", "HOLDER", "COMBHOLDER"];
const STATUS_FIELDS = ["tenstatus", "TENSTATUS", "STATUS", "STATUSDESC"];
const GRANT_FIELDS = ["grantdate", "GRANTDATE", "DATEGRANT", "GRANT_DATE", "startdate", "STARTDATE"];

function pickFirst(props: Record<string, unknown>, fields: readonly string[]): string | undefined {
  // Case-insensitive lookup — DMIRS-003 ships lowercase keys via geojson but
  // some SLIP layers return uppercased columns.
  const lc: Record<string, unknown> = {};
  for (const k of Object.keys(props)) lc[k.toLowerCase()] = props[k];
  for (const f of fields) {
    const v = lc[f.toLowerCase()];
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed.length > 0) return trimmed;
    }
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

function pickEpochMs(props: Record<string, unknown>, fields: readonly string[]): number | undefined {
  const lc: Record<string, unknown> = {};
  for (const k of Object.keys(props)) lc[k.toLowerCase()] = props[k];
  for (const f of fields) {
    const v = lc[f.toLowerCase()];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
    if (typeof v === "string") {
      const n = Date.parse(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return undefined;
}

function pickTenementId(feat: GeoJsonFeature): string | undefined {
  return feat.properties === null ? undefined : pickFirst(feat.properties as Record<string, unknown>, ID_FIELDS);
}

function classifyTenementType(id: string): string {
  // DMIRS tenement IDs come in two shapes off SLIP:
  //   - "E 08/117-I"  (formatted: leading letter then space)
  //   - "E  0800117"  (raw: leading letter then padded digits)
  const m = /^\s*([MEPGL])\b/i.exec(id);
  if (m) return m[1]!.toUpperCase();
  return "?";
}

function isProducingStatus(status: string): boolean {
  // DMIRS-003 status codes: LIVE, PEND (pending), DEAD. "LIVE" means granted
  // and active — i.e. likely producing or actively held. PEND/DEAD do not.
  const s = status.toLowerCase();
  return s === "live" || s.includes("granted") || s.includes("current");
}

function parseTenement(feat: GeoJsonFeature): Tenement | null {
  if (feat.properties === null || typeof feat.properties !== "object") return null;
  const props = feat.properties as Record<string, unknown>;
  const id = pickFirst(props, ID_FIELDS);
  if (!id) return null;
  const holder = pickFirst(props, HOLDER_FIELDS) ?? "(holder not disclosed)";
  const status = pickFirst(props, STATUS_FIELDS) ?? "Unknown";
  const grantedMs = pickEpochMs(props, GRANT_FIELDS);
  const granted = grantedMs !== undefined ? new Date(grantedMs).toISOString().slice(0, 10) : undefined;
  return {
    id,
    type: classifyTenementType(id),
    status,
    holder: holder.trim(),
    granted,
    raw: props,
  };
}

type Synthesis = {
  total: number;
  producing: number;
  byType: Map<string, number>;
  byStatus: Map<string, number>;
  byHolder: Map<string, Tenement[]>;
  recentlyGranted: Tenement[]; // last 5y
  highPriorityProducingM: Tenement[];
};

function synthesise(tenements: Tenement[]): Synthesis {
  const fiveYearsAgo = Date.now() - 5 * 365 * 24 * 60 * 60 * 1000;
  const s: Synthesis = {
    total: tenements.length,
    producing: 0,
    byType: new Map(),
    byStatus: new Map(),
    byHolder: new Map(),
    recentlyGranted: [],
    highPriorityProducingM: [],
  };
  for (const t of tenements) {
    s.byType.set(t.type, (s.byType.get(t.type) ?? 0) + 1);
    s.byStatus.set(t.status, (s.byStatus.get(t.status) ?? 0) + 1);
    const list = s.byHolder.get(t.holder) ?? [];
    list.push(t);
    s.byHolder.set(t.holder, list);

    const producing = isProducingStatus(t.status);
    if (producing) s.producing++;
    if (producing && t.type === "M") s.highPriorityProducingM.push(t);

    if (t.granted) {
      const ts = Date.parse(t.granted);
      if (!Number.isNaN(ts) && ts >= fiveYearsAgo) s.recentlyGranted.push(t);
    }
  }
  return s;
}

// ===== Report rendering =====

function renderReport(input: {
  lgaName: string;
  rawName: string;
  bbox: BoundingBox;
  bufferKm: number;
  queriedAt: string;
  tilesQueried: number;
  cacheHits: number;
  tenements: Tenement[];
  syn: Synthesis;
}): string {
  const { lgaName, rawName, bbox, bufferKm, queriedAt, tilesQueried, cacheHits, syn } = input;
  const pct = (n: number, d: number): string => (d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`);

  const topHolders = [...syn.byHolder.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);

  const top3HolderNames = topHolders.slice(0, 3).map(([h]) => h);

  const typeOrder = ["M", "E", "P", "G", "L", "?"];
  const typeRows = typeOrder
    .filter((t) => syn.byType.has(t))
    .map((t) => `| ${t} | ${syn.byType.get(t)} | ${typeLabel(t)} |`)
    .join("\n");

  const holderRows = topHolders
    .map(([holder, ts]) => {
      const types = [...new Set(ts.map((t) => t.type))].sort().join(", ");
      const evidence = ts.slice(0, 3).map((t) => t.id).join(", ");
      return `| ${escapePipe(holder)} | ${ts.length} | ${types} | ${evidence} |`;
    })
    .join("\n");

  const highPri = syn.highPriorityProducingM.slice(0, 50);
  const highPriRows = highPri
    .map((t) => `| ${t.id} | ${escapePipe(t.holder)} | ${escapePipe(t.status)} | ${t.granted ?? "—"} |`)
    .join("\n");

  return `# Mining tenement review candidates — ${lgaName}

**SOURCE:** DMIRS via SLIP (WA Government public ArcGIS REST)
**LGA matched:** ${rawName}
**Pull timestamp (UTC):** ${queriedAt}
**Bounding box queried:** \`[${bbox.map((n) => n.toFixed(4)).join(", ")}]\` (lng/lat, WGS-84)${bufferKm > 0 ? `\n**Buffer applied:** ${bufferKm} km on each side` : ""}
**Tiles fetched live:** ${tilesQueried} | **Tiles served from cache:** ${cacheHits}

---

## Executive summary

- **${syn.total}** live mining tenement features intersect the ${rawName} bounding box.
- **${syn.producing}** (${pct(syn.producing, syn.total)}) carry a status indicating they are currently producing or actively granted.
- The top three mining holders by tenement count are: ${top3HolderNames.map((h) => `**${h}**`).join(", ") || "(insufficient holder data)"}.
- **${syn.highPriorityProducingM.length}** high-priority candidates identified — producing M-class (Mining Lease) tenements most likely to host operations on parcels currently rated as rural.
- **${syn.recentlyGranted.length}** tenements were granted within the last 5 years and warrant priority review against the council's most recent valuation roll.
- Estimated review-candidate count for follow-up against the council's TechOne CSV: **${syn.total}** parcels (every tenement-overlapped parcel is a speculative candidate until cross-checked).

## By holder (top 10)

| Holder | Tenement count | Types | Top 3 evidence anchors |
| --- | ---: | --- | --- |
${holderRows || "| (no holder data parsed) | — | — | — |"}

## By tenement type

| Type | Count | Description |
| --- | ---: | --- |
${typeRows}

## High-priority — producing Mining Leases (M-class)

These are the parcels most likely to be mis-rated. An active M-class lease implies extractive activity, which under the Local Government Act 1995 (WA) and the Valuation of Land Act 1978 (WA) typically demands a non-rural rate category. Each row below should be cross-checked against the council's current roll.

| Tenement ID | Holder | Status | Granted |
| --- | --- | --- | --- |
${highPriRows || "| (none flagged) | — | — | — |"}

${syn.highPriorityProducingM.length > highPri.length ? `\n*Showing first ${highPri.length} of ${syn.highPriorityProducingM.length} high-priority candidates. Full list available in the cache JSON.*` : ""}

## Methodology + caveats

This report is **speculative**, not conclusive. It does the following:

1. Queries Landgate's public Local Government Authority boundary layer for the LGA polygon and derives a bounding box (with optional buffer).
2. Queries the DMIRS Mining Tenements layer (DMIRS-003) via SLIP's public ArcGIS REST endpoint for every live tenement feature whose geometry intersects that bounding box. Large LGAs are tiled into ~80 km cells to respect the spatial package's per-call area cap; results are deduplicated by tenement ID.
3. Groups results by holder, type, status, and grant age.

What this report does **not** prove:

- It does **not** cross-check the council's rates classification. Without the council's TechOne rates roll, we cannot tell which tenement-overlapped parcels are already correctly rated as mining/industrial vs. mis-rated rural.
- It does **not** map tenement geometry onto cadastral parcel IDs. A tenement may overlap multiple parcels, and a parcel may be partially overlapped — both cases require parcel-level intersection in the recovery engine.
- Status text is taken verbatim from the DMIRS feature. "Live" / "Granted" / "Current" classifications are heuristic; some statuses may be ambiguous.
- A tenement's existence does not, on its own, mandate a rate-category change. Each candidate must be reviewed by a qualified valuer.

## Next steps

1. Request the council's TechOne valuation-roll CSV export for the same LGA.
2. Run \`find_mining_mismatches\` against the combined DMIRS + roll dataset to produce the actual mismatch list with confidence-weighted recovery estimates.
3. Generate per-parcel evidence packs via \`generate_evidence_pack\` for the top mismatches.
4. Walk the high-priority M-class shortlist (above) into the council CFO meeting as the lead-in to the conversation.

---

*Generated by \`scripts/dmirs-lga-pull.ts\`. Source data: DMIRS via SLIP (services.slip.wa.gov.au). All data is public-record WA Government information.*
`;
}

function typeLabel(t: string): string {
  switch (t) {
    case "M": return "Mining Lease";
    case "E": return "Exploration Licence";
    case "P": return "Prospecting Licence";
    case "G": return "General Purpose Lease";
    case "L": return "Miscellaneous Licence";
    default: return "Unclassified";
  }
}

function escapePipe(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ===== Main =====

async function main(): Promise<number> {
  const startedAt = Date.now();
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 2;
  }

  const ac = new AbortController();
  process.on("SIGINT", () => ac.abort());

  console.log(`[dmirs-lga-pull] resolving LGA bbox for "${args.lga}"...`);
  let lgaMatch: LgaMatch;
  try {
    lgaMatch = await findLgaBbox(args.lga, ac.signal);
  } catch (e) {
    console.error(`SLIP unreachable for LGA boundary lookup; not generating speculative report.`);
    console.error(`detail: ${(e as Error).message}`);
    return 1;
  }
  console.log(`[dmirs-lga-pull] matched "${lgaMatch.rawName}" via layer ${lgaMatch.layerId}/${lgaMatch.attrName}`);

  // Apply buffer.
  let bbox: BoundingBox = lgaMatch.bbox;
  if (args.bboxBufferKm > 0) {
    const refLat = (bbox[1] + bbox[3]) / 2;
    const { dLng, dLat } = kmToDeg(args.bboxBufferKm, refLat);
    bbox = [bbox[0] - dLng, bbox[1] - dLat, bbox[2] + dLng, bbox[3] + dLat];
  }
  console.log(`[dmirs-lga-pull] bbox: [${bbox.map((n) => n.toFixed(4)).join(", ")}]`);
  const tiles = tileBbox(bbox);
  console.log(`[dmirs-lga-pull] tiling into ${tiles.length} cells (${TILE_DEG}deg each)`);

  // Pull tenements.
  let pull;
  try {
    pull = await pullTenements(bbox, args.cacheDir, args.fresh, args.maxTenements, ac.signal);
  } catch (e) {
    console.error(`SLIP unreachable; not generating speculative report.`);
    console.error(`detail: ${(e as Error).message}`);
    return 1;
  }
  console.log(`[dmirs-lga-pull] fetched ${pull.features.length} unique tenements (${pull.tilesQueried} live tiles, ${pull.cacheHits} cached)`);

  // Synthesise.
  const tenements: Tenement[] = [];
  for (const f of pull.features) {
    const t = parseTenement(f);
    if (t) tenements.push(t);
  }
  const syn = synthesise(tenements);

  // Report.
  const outPath = resolve(args.out ?? join("reports", `${slugify(args.lga)}-${todayStamp()}.md`));
  if (!existsSync(dirname(outPath))) mkdirSync(dirname(outPath), { recursive: true });
  const md = renderReport({
    lgaName: args.lga,
    rawName: lgaMatch.rawName,
    bbox,
    bufferKm: args.bboxBufferKm,
    queriedAt: pull.queriedAt,
    tilesQueried: pull.tilesQueried,
    cacheHits: pull.cacheHits,
    tenements,
    syn,
  });
  writeFileSync(outPath, md);

  // Console summary.
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  const sizeKb = (statSync(outPath).size / 1024).toFixed(1);
  const topHolders = [...syn.byHolder.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3);
  console.log(``);
  console.log(`=== DMIRS LGA pull summary ===`);
  console.log(`  LGA matched:          ${lgaMatch.rawName}`);
  console.log(`  Tenements found:      ${syn.total}`);
  console.log(`  Producing:            ${syn.producing}`);
  console.log(`  High-priority M-class: ${syn.highPriorityProducingM.length}`);
  console.log(`  Top 3 holders:`);
  for (const [h, ts] of topHolders) console.log(`    - ${h} (${ts.length})`);
  console.log(`  Report:               ${outPath} (${sizeKb} KB)`);
  console.log(`  Runtime:              ${elapsed}s`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`[dmirs-lga-pull] fatal:`, e);
    process.exit(1);
  },
);

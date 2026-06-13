/**
 * @ratesassist/spatial/dataSources — the national data-source catalogue.
 *
 * A single typed registry of every external data feed that powers the edge —
 * what it is, which jurisdiction, how it's accessed, its licence + cost, how
 * fresh it really is, and whether an adapter is wired yet. At government scale
 * (many states × many sources) this manifest is the one place to see the data
 * footprint, drive a "data coverage" view, and gate which sources are safe to
 * surface. Metadata only — the actual fetch logic lives in the per-source
 * adapters (dmirs.ts, sarig.ts, slip.ts, …).
 *
 * Honesty rule baked into `status`: `live` = a real fetch path is wired;
 * `seeded` = adapter exists with graceful fallback but no live GetFeature yet;
 * `planned` = catalogued + researched, adapter not built. `refreshCadence` is
 * the HONEST source cadence — there is no real-time push feed in this domain
 * (see internal/EDGE-DATA-STRATEGY.md): monthly/quarterly batch + live WMS is
 * the ceiling.
 */

export type DataSourceKind = "wfs" | "wms" | "rest" | "file" | "api";
export type DataSourceStatus = "live" | "seeded" | "planned";
export type DataSourceCost = "free" | "free-licence" | "paid";
export type Jurisdiction =
  | "WA" | "SA" | "QLD" | "NSW" | "VIC" | "NT" | "TAS" | "ACT" | "NAT";
export type DataCategory =
  | "mining" | "cadastre" | "valuation" | "buildings" | "planning"
  | "imagery" | "address" | "landuse" | "solar" | "environmental";

export interface DataSourceDescriptor {
  readonly id: string;
  readonly name: string;
  readonly jurisdiction: Jurisdiction;
  readonly category: DataCategory;
  readonly kind: DataSourceKind;
  /** Base URL / OGC endpoint (omitted for bulk-file sources without a service). */
  readonly endpoint?: string;
  /** Allowlisted env override var the adapter reads, if any. */
  readonly envVar?: string;
  readonly licence: string;
  readonly cost: DataSourceCost;
  /** Honest source cadence — NOT real-time (no push feeds exist in this domain). */
  readonly refreshCadence: string;
  readonly status: DataSourceStatus;
  /** Module that implements the fetch, if built. */
  readonly adapter?: string;
  readonly note?: string;
}

/**
 * The catalogue. Verified in internal/EDGE-DATA-STRATEGY.md (E0 + E0b research).
 * Ordered: live/seeded adapters first, then planned-free, then planned-paid.
 */
export const DATA_SOURCES: readonly DataSourceDescriptor[] = [
  {
    id: "wa-dmirs-tenements",
    name: "WA DMIRS Mining Tenements (SLIP)",
    jurisdiction: "WA",
    category: "mining",
    kind: "wfs",
    endpoint: "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Industry_and_Mining/MapServer/WFSServer",
    envVar: "DMIRS_WFS_BASE",
    licence: "WA SLIP public services",
    cost: "free",
    refreshCadence: "SLIP-published (batch)",
    status: "live",
    adapter: "dmirs.ts",
    note: "Live ArcGIS WFS query via SLIP proxy, enabled with RA_LIVE_TENEMENTS=1 (E5c). Seeded fallback when WFS is unreachable or flag is off.",
  },
  {
    id: "wa-landgate-cadastre",
    name: "WA Landgate Cadastre (SLIP WMS)",
    jurisdiction: "WA",
    category: "cadastre",
    kind: "wms",
    endpoint: "https://services.slip.wa.gov.au/public/services/SLIP_Public_Services/Cadastre/MapServer/WMSServer",
    envVar: "NEXT_PUBLIC_LANDGATE_SLIP_WMS",
    licence: "WA SLIP public services",
    cost: "free",
    refreshCadence: "SLIP-published (batch)",
    status: "live",
    adapter: "lib/basemaps.ts (overlay)",
    note: "Live WMS map overlay.",
  },
  {
    id: "sa-sarig-tenements",
    name: "SA SARIG Mineral Tenements",
    jurisdiction: "SA",
    category: "mining",
    kind: "wfs",
    endpoint: "https://services.sarig.sa.gov.au/vector/mineral_tenements/wfs",
    envVar: "SARIG_WFS_BASE",
    licence: "CC BY 3.0 AU",
    cost: "free-licence",
    refreshCadence: "as needed (daily generated files observed)",
    status: "seeded",
    adapter: "sarig.ts",
    note: "SA sibling of DMIRS — extends mining mis-classification detection to SA. WMS sibling at /wms.",
  },
  {
    id: "qld-tenure-wfs",
    name: "QLD Mining & Exploration Tenure (QSpatial WFS)",
    jurisdiction: "QLD",
    category: "mining",
    kind: "wfs",
    endpoint: "https://spatial-gis.information.qld.gov.au/arcgis/services/Economy/MinesPermitsCurrent/MapServer/WFSServer",
    envVar: "QLD_TENURE_WFS_BASE",
    licence: "Qld Open Data (open licence — no per-layer permission needed)",
    cost: "free",
    refreshCadence: "QSpatial-published (batch)",
    status: "seeded",
    adapter: "qld.ts",
    note: "ArcGIS WFSServer on the same MapServer as the WMS (E2). Probe-only now; GetFeature parsing + signal wiring next. Covers EPM/ML/MDL/MC/PC.",
  },
  {
    id: "qld-tenure-wms",
    name: "QLD Mining & Exploration Tenure (QSpatial WMS overlay)",
    jurisdiction: "QLD",
    category: "mining",
    kind: "wms",
    endpoint: "https://spatial-gis.information.qld.gov.au/arcgis/services/Economy/MinesPermitsCurrent/MapServer/WMSServer",
    licence: "Qld Open Data (open licence)",
    cost: "free",
    refreshCadence: "QSpatial-published (batch)",
    status: "live",
    adapter: "lib/basemaps.ts (overlay)",
    note: "Live WMS map overlay wired in E2 (basemaps.ts). 4 layer groups confirmed via GetCapabilities: granted EPM/ML/MDL/MC. Data ingestion via qld-tenure-wfs sibling.",
  },
  {
    id: "nat-dea-ows",
    name: "Digital Earth Australia (Geoscience Australia) OWS",
    jurisdiction: "NAT",
    category: "imagery",
    kind: "wms",
    endpoint: "https://ows.dea.ga.gov.au/",
    licence: "CC BY 4.0 (open)",
    cost: "free",
    refreshCadence: "Sentinel-2/Landsat cadence (days–weeks)",
    status: "planned",
    note: "Free national satellite + change products (WMS/WMTS/WCS). The realistic FREE change-detection layer.",
  },
  {
    id: "nat-gnaf",
    name: "G-NAF — Geocoded National Address File (Geoscape)",
    jurisdiction: "NAT",
    category: "address",
    kind: "file",
    licence: "CC BY 4.0-based EULA (+ mail/APP caveats)",
    cost: "free-licence",
    refreshCadence: "quarterly",
    status: "planned",
    adapter: "gnaf.ts (interface scaffolded; bulk ingest pending the ~GB release file)",
    note: "Free national address spine — the join key for cadastre↔valuation↔buildings↔business. Bulk file, not a service.",
  },
  {
    id: "nsw-minview-tenements",
    name: "NSW MinView Exploration & Mining Titles (SEED)",
    jurisdiction: "NSW",
    category: "mining",
    kind: "wfs",
    licence: "check per-layer (some require permission)",
    cost: "free-licence",
    refreshCadence: "SEED-published (batch)",
    status: "planned",
    note: "WFS+WMS+CSV. Licence-check on some layers before wiring.",
  },
  {
    id: "vic-geovic-tenements",
    name: "VIC Current Mining Licences & Exploration (GeoVic / data.vic)",
    jurisdiction: "VIC",
    category: "mining",
    kind: "wfs",
    licence: "Victorian open data",
    cost: "free",
    refreshCadence: "data.vic-published (batch)",
    status: "planned",
    note: "GeoVic is the viewer; confirm the WFS/WMS endpoint before wiring.",
  },
  {
    id: "nsw-vg-land-values",
    name: "NSW Valuer-General bulk land values",
    jurisdiction: "NSW",
    category: "valuation",
    kind: "file",
    licence: "CC BY 4.0",
    cost: "free-licence",
    refreshCadence: "monthly (republication; values set annually)",
    status: "planned",
    note: "Free monthly per-LGA CSV ZIP (email for bulk access). Value-change recovery targeting for NSW.",
  },
  {
    id: "nat-geoscape-buildings",
    name: "Geoscape Buildings (national)",
    jurisdiction: "NAT",
    category: "buildings",
    kind: "file",
    licence: "Geoscape commercial",
    cost: "paid",
    refreshCadence: "quarterly (with change detection)",
    status: "planned",
    note: "THE mis-classification edge: footprint+area+roof+SOLAR+POOL+zone per building, national. PAID → Q-edge-geoscape.",
  },
  {
    id: "nat-metromap-insights",
    name: "MetroMap Insights (Aerometrex) — AI feature extraction + change detection",
    jurisdiction: "NAT",
    category: "imagery",
    kind: "api",
    licence: "Aerometrex commercial",
    cost: "paid",
    refreshCadence: "imagery flights + temporal change detection",
    status: "planned",
    note: "AI-extracted buildings/pools/solar/trees + change detection AU-wide. PAID → Q-edge-imagery (bake-off vs Geoscape Buildings).",
  },
];

/** List sources, optionally filtered by jurisdiction / category / cost / status. */
export function listDataSources(filter?: {
  jurisdiction?: Jurisdiction;
  category?: DataCategory;
  cost?: DataSourceCost;
  status?: DataSourceStatus;
}): readonly DataSourceDescriptor[] {
  if (!filter) return DATA_SOURCES;
  return DATA_SOURCES.filter(
    (s) =>
      (filter.jurisdiction === undefined || s.jurisdiction === filter.jurisdiction) &&
      (filter.category === undefined || s.category === filter.category) &&
      (filter.cost === undefined || s.cost === filter.cost) &&
      (filter.status === undefined || s.status === filter.status),
  );
}

/** Look up one source by id. */
export function getDataSource(id: string): DataSourceDescriptor | undefined {
  return DATA_SOURCES.find((s) => s.id === id);
}

/** Free (no contract) sources — the decision-independent build set. */
export function freeDataSources(): readonly DataSourceDescriptor[] {
  return DATA_SOURCES.filter((s) => s.cost !== "paid");
}

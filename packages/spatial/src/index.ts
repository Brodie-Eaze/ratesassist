/**
 * @ratesassist/spatial
 *
 * Spatial integrations for the RatesAssist platform: SLIP/Landgate ArcGIS
 * REST queries, DMIRS WFS probes, and pure geometry helpers. Depends only
 * on `@ratesassist/contract` and `zod`.
 */

export * from "./types.js";
export {
  SLIP_LAYERS,
  BoundingBoxSchema,
  fetchSlipFeatures,
  type SlipLayerKey,
  type FetchSlipFeaturesOptions,
} from "./slip.js";
export {
  fetchDmirsTenementsForCouncil,
  parseWfsFeatureCollection,
  type FetchDmirsOptions,
} from "./dmirs.js";
export {
  fetchRecentlyGrantedTenements,
  parseTenidDisplay,
  buildMinedexUrl,
  tenementTypeLabel,
  tenementBoundingBox,
  pointInTenementBbox,
  MINEDEX_DETAIL_URL_BASE,
  WA_FULL_BBOX,
  SEEDED_GRANTS,
  type GrantedTenement,
  type GrantsFetchResult,
  type RecentlyGrantedOpts,
} from "./grants.js";
export { bufferPolygon } from "./buffer.js";
export {
  compareAddressRecords,
  type AddressDiscrepancy,
  type AddressDiscrepancyKind,
  type AddressDiscrepancySeverity,
  type CompareAddressRecordsInput,
} from "./addressDiscrepancy.js";
export {
  createLandgateClient,
  type LandgateRestrictedClient,
  type LandgateParcelDetail,
  type LandgateLogger,
  type CreateLandgateClientConfig,
} from "./landgateRestricted.js";
export {
  LANDGATE_MOCK_PARCELS,
  createMockLandgateClient,
} from "./__fixtures__/landgateMock.js";
export {
  findLagWindowCandidates,
  classifyLanduse,
  severityHintFor,
  buildLandgateLocateUrl,
  SEEDED_LAGWINDOW_PARCELS,
  DPIRD_LANDUSE_LAYER_URL,
  LANDGATE_LOCATE_BASE,
  type LagCandidate,
  type LandgateParcel,
  type LanduseCategory,
  type LagSeverityHint,
  type LagFetchResult,
  type FindLagWindowOptions,
} from "./lagWindow.js";

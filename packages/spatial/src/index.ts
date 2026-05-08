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
export { bufferPolygon } from "./buffer.js";

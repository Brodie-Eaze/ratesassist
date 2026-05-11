/**
 * Landgate restricted-tier client — abstract interface + default stub.
 *
 * Landgate's "restricted-tier" data products (LGATE-002 Cadastre With
 * Attributes, Notations on Title, RPDLU landuse codes, PSI sales,
 * Geocoded Addressing Service) require either a council subscription
 * or a Government Information Licence Framework approval. RatesAssist
 * itself does NOT hold those licences — production wiring consumes the
 * council's already-licensed Landgate data via the rating-system
 * adapter (TechOne CiAnywhere export). See internal/LANDGATE-ACCESS.md
 * for the access pathway, cost estimates, and DSA template pointers.
 *
 * The default `createLandgateClient` factory returns an implementation
 * that throws on every call. The mock implementation in
 * `./__fixtures__/landgateMock.ts` reads from a small fixture set and
 * is used by demo + tests. Adapter authors who plug a real Landgate
 * connection swap the factory at the call-site.
 */

/** Minimal pino-shaped logger surface. Adapter layer injects the real one. */
export type LandgateLogger = {
  readonly warn: (obj: unknown, msg?: string) => void;
  readonly error: (obj: unknown, msg?: string) => void;
  readonly info: (obj: unknown, msg?: string) => void;
};

const consoleLogger: LandgateLogger = {
  warn: (obj, msg) => console.warn(`[landgate] ${msg ?? ""}`, obj),
  error: (obj, msg) => console.error(`[landgate] ${msg ?? ""}`, obj),
  info: (obj, msg) => console.info(`[landgate] ${msg ?? ""}`, obj),
};

export type LandgateParcelDetail = {
  /** Landgate Property Identifier Number (PIN). Stable across renumbers. */
  readonly pin: string;
  /** Lot + Plan reference, e.g. "Lot 42 DP 18337". */
  readonly lotPlan: string;
  /** Full street address as Landgate records it. */
  readonly address: string;
  /** RPDLU landuse code (numeric string, e.g. "513"). */
  readonly landuseCode: string;
  /** Human-readable landuse description, e.g. "Industrial - mining infrastructure". */
  readonly landuseDescription: string;
  /** Parcel area in square metres. */
  readonly areaSquareMetres: number;
  /** Notations on title (interests, encumbrances, mining tenement refs). */
  readonly notations: ReadonlyArray<{
    readonly type: string;
    readonly reference: string;
    readonly date: string;
  }>;
};

export interface LandgateRestrictedClient {
  readonly getParcelByLot: (lot: string, plan: string) => Promise<LandgateParcelDetail | null>;
  readonly getParcelByPin: (pin: string) => Promise<LandgateParcelDetail | null>;
  readonly searchByAddress: (address: string) => Promise<ReadonlyArray<LandgateParcelDetail>>;
}

export type CreateLandgateClientConfig = {
  /** API key for the Locate Data Portal / restricted-tier endpoints. */
  readonly apiKey?: string;
  /** Override base URL (e.g. for staging). */
  readonly baseUrl?: string;
  /** Optional pino-compatible logger. */
  readonly logger?: LandgateLogger;
};

/**
 * Default Landgate restricted-tier client. Without credentials it throws
 * a structured error pointing the caller at the access-pathway doc.
 * Production callers either configure `apiKey` (once a council DSA is in
 * place) or swap the factory for the mock pathway in tests.
 */
export function createLandgateClient(
  config: CreateLandgateClientConfig = {},
): LandgateRestrictedClient {
  const log = config.logger ?? consoleLogger;
  if (config.apiKey === undefined || config.apiKey === "") {
    const fail = async (op: string): Promise<never> => {
      log.warn(
        { op, hint: "internal/LANDGATE-ACCESS.md" },
        "Landgate restricted-tier client called without an apiKey",
      );
      throw new Error(
        `Landgate restricted-tier not configured (${op}). See internal/LANDGATE-ACCESS.md ` +
          `for the access pathway, DSA template, and council-subcontractor provisions.`,
      );
    };
    return {
      getParcelByLot: () => fail("getParcelByLot"),
      getParcelByPin: () => fail("getParcelByPin"),
      searchByAddress: () => fail("searchByAddress"),
    };
  }

  // Live wiring is intentionally not implemented in this package — the
  // adapter layer plugs a real client when credentials and DSA are in
  // place. See internal/LANDGATE-ACCESS.md.
  throw new Error(
    `Landgate restricted-tier live transport not implemented in @ratesassist/spatial. ` +
      `Wire a council-supplied client at the adapter layer. baseUrl=${config.baseUrl ?? "(default)"}`,
  );
}

/**
 * mismatchSql — SQL-side mismatch candidate pre-filter (E3).
 *
 * Returns the set of assessment numbers for properties that MIGHT fire at
 * least one recovery signal, scoped to a single tenant. This is a broad
 * pre-filter — false positives (included when no signal actually fires) are
 * acceptable; false negatives (excluded when a signal would fire) are NOT.
 *
 * ## What the filter covers
 *
 * (a) Rural or Vacant properties — required for all tenement-class signals
 *     and the high-value-rural outlier signal. By including ALL rural/vacant
 *     properties the `ruralBySuburb` index in the evaluation context remains
 *     complete so percentile-based signals are not skewed.
 *
 * (b) Properties with `pensioner_rebate = true` — for concession signals.
 *
 * (c) Properties with a live tenement overlay (via `tenement_properties`
 *     join) — currently needed for EMITS + future LAG signals that can fire
 *     on any land use (not just Rural/Vacant).
 *
 * ## What the filter SAFELY excludes
 *
 * Urban/Residential/Commercial/Industrial properties with:
 *   - no tenement overlay, AND
 *   - no pensioner rebate
 *
 * None of the currently implemented signals fire on these properties.
 * When a new signal is added that can fire on residential parcels, add a
 * corresponding condition here before wiring it into `evaluateSignals`.
 *
 * ## Join table vs JSONB array
 *
 * The `tenement_properties` join table has FK-backed indexes on
 * (`tenement_id`, `property_id`) that PostgreSQL uses efficiently. The
 * `intersects_assessment_numbers` JSONB column on `tenements` would require
 * a GIN index or a slow `jsonb_array_elements` unnest for this check. We
 * always use the join table for SQL-side queries.
 *
 * ## Scale target
 *
 * At 100k properties/tenant, a typical WA council has ~60-70% urban
 * residential parcels with no tenement overlay and no pensioner rebate. The
 * pre-filter reduces the in-memory load to roughly 30-40k rows (rural +
 * tenement-overlapping + pensioner) before `findMismatches` runs.
 */

// `@ratesassist/db` is dynamically imported by callers (via `getWebDb`);
// this module only declares the type so the WASM payload stays off the
// synchronous module graph.
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
type Db = import("@ratesassist/db").Db;

/**
 * Normalise the raw return value of `db.execute(sql\`...\`)`.
 *
 * Drizzle wraps the underlying driver's raw `client.query()` result without
 * extracting `.rows` for raw SQL (prepared query with `fields = undefined`).
 * Both pglite and node-postgres return `{ rows: Row[], ... }`, so the value
 * you actually `await` is that shape — not a plain array.  We follow the
 * same defensive pattern as `@ratesassist/db`'s `extractHeadHash()`:
 *   - If the result is already an array → use it directly.
 *   - If it has a `.rows` array → return that.
 *   - Fallback to empty array.
 */
function extractRowsFromExecute(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  if (raw !== null && typeof raw === "object" && Array.isArray((raw as { rows?: unknown }).rows)) {
    return (raw as { rows: unknown[] }).rows as Array<Record<string, unknown>>;
  }
  return [];
}

/**
 * Returns the set of assessment numbers that are pre-candidates for at least
 * one recovery signal, scoped to the specified tenant.
 *
 * The query runs a single `SELECT DISTINCT` with OR-combined conditions so
 * the Postgres planner can use the `properties_tenant_idx` index across all
 * branches in a single bitmap-scan rather than the naive union-of-three-scans
 * approach.
 *
 * @param db   The active Drizzle/pglite connection.
 * @param tenantId  UUID of the tenant to scan.
 * @returns    Immutable Set of assessment_number strings.
 */
export async function findCandidateAssessmentsBySql(
  db: Db,
  tenantId: string,
): Promise<ReadonlySet<string>> {
  // Dynamic import to keep drizzle + pglite out of the synchronous graph.
  const { sql } = await import("@ratesassist/db");

  const raw = await (db as unknown as {
    execute: (q: unknown) => Promise<unknown>;
  }).execute(sql`
    SELECT DISTINCT p.assessment_number
    FROM properties p
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.deleted_at IS NULL
      AND (
        -- (a) Rural / Vacant: tenement-class signals + outlier baseline
        p.land_use IN ('Rural', 'Vacant')
        -- (b) Pensioner rebate: concession signals
        OR p.pensioner_rebate = true
        -- (c) Live tenement overlay via relational join table
        OR EXISTS (
          SELECT 1
          FROM tenement_properties tp
          INNER JOIN tenements t ON t.id = tp.tenement_id
          WHERE tp.property_id = p.id
            AND t.status = 'Live'
        )
      )
  `);
  const rows = extractRowsFromExecute(raw);

  const out = new Set<string>();
  for (const row of rows) {
    const an = row["assessment_number"] as string | null | undefined;
    if (typeof an === "string" && an.length > 0) {
      out.add(an);
    }
  }
  return out;
}

/**
 * Convenience wrapper: returns true when at least one candidate exists for
 * the tenant. Cheaper than calling findCandidateAssessmentsBySql and
 * checking size — the subquery exits on the first match.
 */
export async function hasAnyCandidatesBySql(
  db: Db,
  tenantId: string,
): Promise<boolean> {
  const { sql } = await import("@ratesassist/db");
  const raw = await (db as unknown as {
    execute: (q: unknown) => Promise<unknown>;
  }).execute(sql`
    SELECT 1
    FROM properties p
    WHERE p.tenant_id = ${tenantId}::uuid
      AND p.deleted_at IS NULL
      AND (
        p.land_use IN ('Rural', 'Vacant')
        OR p.pensioner_rebate = true
        OR EXISTS (
          SELECT 1
          FROM tenement_properties tp
          INNER JOIN tenements t ON t.id = tp.tenement_id
          WHERE tp.property_id = p.id
            AND t.status = 'Live'
        )
      )
    LIMIT 1
  `);
  return extractRowsFromExecute(raw).length > 0;
}

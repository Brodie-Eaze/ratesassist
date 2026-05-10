-- RatesAssist Phase 2 — initial schema.
-- Hand-written to keep the diff readable; future migrations may use drizzle-kit
-- generated output. Everything in this file is idempotent at the CREATE level
-- (IF NOT EXISTS) so it can be re-applied during development.

-- Required for gen_random_uuid() in defaults.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ===== Enums =====

DO $$ BEGIN
  CREATE TYPE australian_state AS ENUM ('WA','NSW','VIC','QLD','SA','TAS','ACT','NT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE land_use AS ENUM ('Residential','Commercial','Industrial','Rural','Vacant','Mining');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM ('Direct Debit','BPAY','Counter','Mail');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE abn_status AS ENUM ('Active','Cancelled','Suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE transaction_type AS ENUM ('Rates Levy','Payment','Adjustment','Penalty Interest');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tenement_type AS ENUM ('M','E','P','G','L');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tenement_status AS ENUM ('Live','Pending','Surrendered','Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE mismatch_severity AS ENUM ('high','medium','low');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE actor_kind AS ENUM ('user','service','llm');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ===== Tables =====

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  state australian_state NOT NULL,
  center_lat double precision NOT NULL,
  center_lng double precision NOT NULL,
  population integer NOT NULL,
  rateable_properties integer NOT NULL,
  rate_revenue numeric(18,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_code_unique ON tenants(code);

CREATE TABLE IF NOT EXISTS properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  assessment_number text NOT NULL,
  address text NOT NULL,
  suburb text NOT NULL,
  postcode text NOT NULL,
  state australian_state NOT NULL,
  land_use land_use NOT NULL,
  valuation numeric(18,2) NOT NULL,
  annual_rates numeric(18,2) NOT NULL,
  balance numeric(18,2) NOT NULL,
  last_payment_date timestamptz,
  last_payment_amount numeric(18,2),
  payment_method payment_method,
  pensioner_rebate boolean NOT NULL DEFAULT false,
  payment_arrangement boolean NOT NULL DEFAULT false,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  centroid_lat double precision NOT NULL,
  centroid_lng double precision NOT NULL,
  parcel jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS properties_tenant_assessment_unique
  ON properties(tenant_id, assessment_number);
CREATE INDEX IF NOT EXISTS properties_tenant_idx ON properties(tenant_id);

CREATE TABLE IF NOT EXISTS owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  owner_ext_id text NOT NULL,
  name text NOT NULL,
  abn text,
  abn_status abn_status,
  abn_checked_at timestamptz,
  postal_address text NOT NULL,
  email text,
  phone text,
  owner_since text NOT NULL,
  previous_owners jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS owners_tenant_ext_id_unique
  ON owners(tenant_id, owner_ext_id);
CREATE INDEX IF NOT EXISTS owners_tenant_idx ON owners(tenant_id);

CREATE TABLE IF NOT EXISTS property_owners (
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, owner_id)
);

CREATE TABLE IF NOT EXISTS tenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenement_id text NOT NULL,
  type tenement_type NOT NULL,
  status tenement_status NOT NULL,
  holder text NOT NULL,
  holder_abn text,
  commodity jsonb NOT NULL DEFAULT '[]'::jsonb,
  granted_date text NOT NULL,
  expiry_date text NOT NULL,
  area_hectares double precision NOT NULL,
  intersects_assessment_numbers jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_producing boolean NOT NULL DEFAULT false,
  last_work_program_year integer,
  polygon jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenement_properties (
  tenement_id uuid NOT NULL REFERENCES tenements(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (tenement_id, property_id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  date timestamptz NOT NULL,
  type transaction_type NOT NULL,
  amount numeric(18,2) NOT NULL,
  reference text NOT NULL,
  running_balance numeric(18,2) NOT NULL
);
CREATE INDEX IF NOT EXISTS transactions_tenant_property_idx
  ON transactions(tenant_id, property_id);

CREATE TABLE IF NOT EXISTS signal_hits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  signal_id text NOT NULL,
  weight double precision NOT NULL,
  evidence text NOT NULL,
  fired_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signal_hits_tenant_property_idx
  ON signal_hits(tenant_id, property_id);

CREATE TABLE IF NOT EXISTS mismatch_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind text NOT NULL,
  severity mismatch_severity NOT NULL,
  reason text NOT NULL,
  est_annual_rates_new numeric(18,2) NOT NULL,
  est_uplift numeric(18,2) NOT NULL,
  est_arrears_3y numeric(18,2) NOT NULL,
  composite_score double precision NOT NULL,
  signals_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mismatch_candidates_tenant_idx
  ON mismatch_candidates(tenant_id);

CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_id text NOT NULL,
  actor_kind actor_kind NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  before jsonb,
  after jsonb,
  correlation_id text,
  ip text,
  user_agent text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_occurred_idx
  ON audit_log(tenant_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS commit_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  scope text NOT NULL,
  payload_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  label text NOT NULL,
  hash text NOT NULL,
  scopes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

-- Phase 3 stubs (subject to expansion).
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  email text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);

-- ===== Row-Level Security =====
--
-- Every business table is RLS-enabled and FORCED. Application code MUST
-- connect as a non-superuser role and set `app.tenant_id` per transaction
-- via `withTenant()` in the client. The `app_user` role referenced by the
-- policies must be created at deploy time:
--
--   CREATE ROLE app_user NOINHERIT NOSUPERUSER;
--   GRANT CONNECT ON DATABASE ratesassist TO app_user;
--   GRANT USAGE ON SCHEMA public TO app_user;
--   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
--   REVOKE UPDATE, DELETE ON audit_log FROM app_user;
--
-- The DBA / migration runner role (the role applying THIS file) is exempt
-- via FORCE ROW LEVEL SECURITY only applying to the table owner if BYPASSRLS
-- is not held. RDS-managed admin roles do hold BYPASSRLS, which is fine for
-- migrations. Production app traffic uses `app_user`.

ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON properties;
CREATE POLICY tenant_isolation_select ON properties FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON properties;
CREATE POLICY tenant_isolation_modify ON properties FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE owners FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON owners;
CREATE POLICY tenant_isolation_select ON owners FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON owners;
CREATE POLICY tenant_isolation_modify ON owners FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON transactions;
CREATE POLICY tenant_isolation_select ON transactions FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON transactions;
CREATE POLICY tenant_isolation_modify ON transactions FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE signal_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_hits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON signal_hits;
CREATE POLICY tenant_isolation_select ON signal_hits FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON signal_hits;
CREATE POLICY tenant_isolation_modify ON signal_hits FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE mismatch_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE mismatch_candidates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON mismatch_candidates;
CREATE POLICY tenant_isolation_select ON mismatch_candidates FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON mismatch_candidates;
CREATE POLICY tenant_isolation_modify ON mismatch_candidates FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- audit_log: SELECT scoped by tenant; INSERT scoped by tenant; UPDATE/DELETE revoked.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON audit_log;
CREATE POLICY tenant_isolation_select ON audit_log FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_insert ON audit_log;
CREATE POLICY tenant_isolation_insert ON audit_log FOR INSERT
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
REVOKE UPDATE, DELETE ON audit_log FROM PUBLIC;

ALTER TABLE commit_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE commit_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON commit_tokens;
CREATE POLICY tenant_isolation_select ON commit_tokens FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON commit_tokens;
CREATE POLICY tenant_isolation_modify ON commit_tokens FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_select ON api_keys;
CREATE POLICY tenant_isolation_select ON api_keys FOR SELECT
  USING (tenant_id::text = current_setting('app.tenant_id', true));
DROP POLICY IF EXISTS tenant_isolation_modify ON api_keys;
CREATE POLICY tenant_isolation_modify ON api_keys FOR ALL
  USING (tenant_id::text = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

-- tenants table is intentionally NOT RLS-enabled: application code reads
-- the tenant directory before establishing the GUC. Access to it is gated
-- at the application authentication layer and via the explicit GRANTs on
-- the `app_user` role.

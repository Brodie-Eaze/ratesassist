# -----------------------------------------------------------------------------
# Secrets module — Secrets Manager entries injected into the task at runtime.
#
# Three secrets the app requires (names confirmed against the codebase):
#   ANTHROPIC_API_KEY  -> apps/web/lib/llm.ts
#   DATABASE_URL       -> packages/db/src/client.ts (value written by db module)
#   RA_AUTH_SECRET     -> apps/web/lib/auth.ts (>=16 chars, app refuses to start without it)
#
# Design for "secrets never in state where avoidable":
#   - ANTHROPIC_API_KEY: shell only by default. A version is created ONLY if a
#     seed is passed; otherwise the human sets it via `aws secretsmanager
#     put-secret-value` and it never touches Terraform state.
#   - RA_AUTH_SECRET: Terraform generates a random 48-char value if no seed is
#     given. (This lands in state; acceptable for a generated rotatable secret.
#     To keep it fully out of state, pass an empty seed and the lifecycle
#     ignore_changes below lets you overwrite it out-of-band without drift.)
#   - DATABASE_URL: shell only here; the db module writes the version once the
#     RDS endpoint + generated password are known.
# -----------------------------------------------------------------------------

# ---- ANTHROPIC_API_KEY --------------------------------------------------------

resource "aws_secretsmanager_secret" "anthropic_api_key" {
  name                    = "${var.name_prefix}/ANTHROPIC_API_KEY"
  description             = "Anthropic API key for the RatesAssist LLM client."
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "anthropic_api_key" {
  count         = var.anthropic_api_key != "" ? 1 : 0
  secret_id     = aws_secretsmanager_secret.anthropic_api_key.id
  secret_string = var.anthropic_api_key
}

# ---- RA_AUTH_SECRET (session HMAC key) ----------------------------------------

resource "random_password" "ra_auth_secret" {
  count   = var.ra_auth_secret == "" ? 1 : 0
  length  = 48
  special = false # alnum keeps it env-safe; 48 chars >> the 16-char minimum
}

resource "aws_secretsmanager_secret" "ra_auth_secret" {
  name                    = "${var.name_prefix}/RA_AUTH_SECRET"
  description             = "HMAC signing key for RatesAssist session cookies."
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_days
  tags                    = var.tags
}

resource "aws_secretsmanager_secret_version" "ra_auth_secret" {
  secret_id = aws_secretsmanager_secret.ra_auth_secret.id
  secret_string = (
    var.ra_auth_secret != ""
    ? var.ra_auth_secret
    : random_password.ra_auth_secret[0].result
  )

  # Allow rotation out-of-band (aws secretsmanager put-secret-value) without
  # Terraform forcing the value back on the next apply.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---- DATABASE_URL (shell; value written by the database module) ---------------

resource "aws_secretsmanager_secret" "database_url" {
  name                    = "${var.name_prefix}/DATABASE_URL"
  description             = "Postgres connection string for RatesAssist (written from RDS endpoint + generated password)."
  kms_key_id              = var.kms_key_arn
  recovery_window_in_days = var.recovery_window_days
  tags                    = var.tags
}

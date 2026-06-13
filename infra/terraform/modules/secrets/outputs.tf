output "anthropic_api_key_arn" {
  description = "ARN of the ANTHROPIC_API_KEY secret (referenced by the task definition)."
  value       = aws_secretsmanager_secret.anthropic_api_key.arn
}

output "ra_auth_secret_arn" {
  description = "ARN of the RA_AUTH_SECRET secret."
  value       = aws_secretsmanager_secret.ra_auth_secret.arn
}

output "database_url_arn" {
  description = "ARN of the DATABASE_URL secret (value written by the database module)."
  value       = aws_secretsmanager_secret.database_url.arn
}

output "database_url_secret_id" {
  description = "ID of the DATABASE_URL secret, so the database module can attach the version."
  value       = aws_secretsmanager_secret.database_url.id
}

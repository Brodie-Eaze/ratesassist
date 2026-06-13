output "endpoint" {
  description = "RDS connection endpoint (host:port)."
  value       = aws_db_instance.this.endpoint
}

output "address" {
  description = "RDS hostname."
  value       = aws_db_instance.this.address
}

output "port" {
  description = "RDS port."
  value       = aws_db_instance.this.port
}

output "db_name" {
  description = "Initial database name."
  value       = aws_db_instance.this.db_name
}

output "instance_id" {
  description = "RDS instance identifier."
  value       = aws_db_instance.this.id
}

output "proxy_endpoint" {
  description = "RDS Proxy endpoint (null when enable_rds_proxy = false)."
  value       = one(aws_db_proxy.this[*].endpoint)
}

output "app_user_secret_arn" {
  description = "ARN of the app_user credentials secret used by the proxy + the provision step (null when proxy disabled)."
  value       = one(aws_secretsmanager_secret.app_user[*].arn)
}

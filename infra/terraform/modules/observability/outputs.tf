output "log_group_name" {
  description = "CloudWatch log group name."
  value       = aws_cloudwatch_log_group.app.name
}

output "log_group_arn" {
  description = "CloudWatch log group ARN."
  value       = aws_cloudwatch_log_group.app.arn
}

output "sns_topic_arn" {
  description = "SNS topic ARN alarms publish to."
  value       = aws_sns_topic.alarms.arn
}

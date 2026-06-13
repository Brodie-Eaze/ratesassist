output "alb_arn" {
  description = "ALB ARN."
  value       = aws_lb.this.arn
}

output "alb_dns_name" {
  description = "ALB DNS name."
  value       = aws_lb.this.dns_name
}

output "alb_zone_id" {
  description = "ALB canonical hosted zone ID (for Route53 ALIAS)."
  value       = aws_lb.this.zone_id
}

output "alb_arn_suffix" {
  description = "ALB ARN suffix (for CloudWatch dimensions)."
  value       = aws_lb.this.arn_suffix
}

output "target_group_arn" {
  description = "Target group ARN (ECS service registers tasks here)."
  value       = aws_lb_target_group.this.arn
}

output "target_group_arn_suffix" {
  description = "Target group ARN suffix (for CloudWatch dimensions)."
  value       = aws_lb_target_group.this.arn_suffix
}

output "certificate_arn" {
  description = "ARN of the validated ACM certificate."
  value       = aws_acm_certificate_validation.this.certificate_arn
}

output "record_fqdn" {
  description = "The FQDN of the ALIAS record created for the app."
  value       = aws_route53_record.app.fqdn
}

# -----------------------------------------------------------------------------
# DNS + certificate module.
#
#   - ACM certificate for the app domain, DNS-validated (no email approval).
#   - Validation CNAMEs written into the provided Route53 zone.
#   - aws_acm_certificate_validation blocks until the cert is ISSUED so the ALB
#     HTTPS listener never references a pending cert.
#   - A/ALIAS record pointing the app domain at the ALB.
#
# The cert is issued in this provider's region (ap-southeast-2) because it
# terminates on a regional ALB. (CloudFront would require us-east-1, but there
# is no CloudFront here — keeping everything in Sydney for AU residency.)
# -----------------------------------------------------------------------------

resource "aws_acm_certificate" "this" {
  domain_name       = var.domain_name
  validation_method = "DNS"

  tags = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "validation" {
  for_each = {
    for dvo in aws_acm_certificate.this.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  zone_id         = var.hosted_zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "this" {
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for r in aws_route53_record.validation : r.fqdn]
}

resource "aws_route53_record" "app" {
  zone_id = var.hosted_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

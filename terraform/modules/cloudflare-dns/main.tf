terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
}

resource "cloudflare_record" "root" {
  zone_id = var.zone_id
  name    = var.domain
  value   = var.server_ip
  type    = "A"
  ttl     = var.ttl
  proxied = var.proxied
}

resource "cloudflare_record" "www" {
  count   = var.create_www ? 1 : 0
  zone_id = var.zone_id
  name    = "www.${var.domain}"
  value   = var.server_ip
  type    = "A"
  ttl     = var.ttl
  proxied = var.proxied
}

terraform {
  required_providers {
    upstash = {
      source  = "upstash/upstash"
      version = "~> 1.5"
    }
  }
}

resource "upstash_redis_database" "main" {
  database_name = var.name
  region        = var.region
  tls           = true
  eviction      = var.eviction
}

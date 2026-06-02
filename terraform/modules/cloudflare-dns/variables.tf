variable "zone_id" {
  description = "Cloudflare zone ID for the domain"
  type        = string
}

variable "domain" {
  description = "Root domain name (e.g. myproject.com)"
  type        = string
}

variable "server_ip" {
  description = "IPv4 address to point DNS records at"
  type        = string
}

variable "ttl" {
  description = "DNS TTL in seconds (1 = automatic when proxied)"
  type        = number
  default     = 1
}

variable "proxied" {
  description = "Whether to proxy traffic through Cloudflare"
  type        = bool
  default     = false
}

variable "create_www" {
  description = "Whether to create a www subdomain record"
  type        = bool
  default     = true
}

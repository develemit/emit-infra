output "root_record_id" {
  description = "Cloudflare DNS record ID for the root domain"
  value       = cloudflare_record.root.id
}

output "www_record_id" {
  description = "Cloudflare DNS record ID for the www subdomain"
  value       = var.create_www ? cloudflare_record.www[0].id : null
}

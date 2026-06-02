output "bucket_name" {
  description = "The created R2 bucket name"
  value       = cloudflare_r2_bucket.main.name
}

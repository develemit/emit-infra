output "redis_url" {
  description = "Redis connection URL (rediss://...)"
  value       = "rediss://:${upstash_redis_database.main.password}@${upstash_redis_database.main.endpoint}:${upstash_redis_database.main.port}"
  sensitive   = true
}

output "endpoint" {
  description = "Redis host endpoint"
  value       = upstash_redis_database.main.endpoint
}

output "port" {
  description = "Redis port"
  value       = upstash_redis_database.main.port
}

output "password" {
  description = "Redis password"
  value       = upstash_redis_database.main.password
  sensitive   = true
}

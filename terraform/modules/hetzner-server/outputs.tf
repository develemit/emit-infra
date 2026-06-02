output "ipv4_address" {
  description = "Public IPv4 address of the server"
  value       = hcloud_server.main.ipv4_address
}

output "ipv6_address" {
  description = "Public IPv6 address of the server"
  value       = hcloud_server.main.ipv6_address
}

output "server_id" {
  description = "Hetzner server ID"
  value       = hcloud_server.main.id
}

output "firewall_id" {
  description = "Hetzner firewall ID"
  value       = hcloud_firewall.main.id
}

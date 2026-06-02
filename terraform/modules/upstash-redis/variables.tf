variable "name" {
  description = "Upstash Redis database name"
  type        = string
}

variable "region" {
  description = "Upstash region (us-east-1, eu-west-1, ap-southeast-1, etc.)"
  type        = string
  default     = "eu-west-1"
}

variable "eviction" {
  description = "Whether to enable key eviction when memory is full"
  type        = bool
  default     = false
}

variable "account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "bucket_name" {
  description = "R2 bucket name (globally unique within the account)"
  type        = string
}

variable "location" {
  description = "R2 storage location hint (WNAM, ENAM, WEUR, EEUR, APAC)"
  type        = string
  default     = "WEUR"
}

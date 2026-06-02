variable "name" {
  description = "Unique project name used for server and resource naming"
  type        = string
}

variable "server_type" {
  description = "Hetzner server type (e.g. cx22, cx32, cx42)"
  type        = string
  default     = "cx22"
}

variable "location" {
  description = "Hetzner datacenter location (nbg1, fsn1, hel1, ash, hil)"
  type        = string
  default     = "nbg1"
}

variable "image" {
  description = "Server OS image"
  type        = string
  default     = "ubuntu-24.04"
}

variable "ssh_key_name" {
  description = "Name of the SSH key in Hetzner Cloud to install on the server"
  type        = string
  default     = "emit-deploy"
}

variable "labels" {
  description = "Additional labels to apply to the server"
  type        = map(string)
  default     = {}
}

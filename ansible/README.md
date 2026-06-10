# Ansible Provisioning for emit-infra

This directory contains Ansible playbooks and roles for provisioning and deploying emit-infra projects on Hetzner Cloud or similar Linux servers.

## Structure

- **`playbooks/`** — Entry-point playbooks
  - `provision.yml` — Full server provisioning (OS packages, Docker, nginx, certbot, blue-green setup)
  - `deploy.yml` — Application deployment (pull images, start containers, health checks)

- **`roles/`** — Reusable provisioning modules
  - `common` — OS hardening, swap, UFW firewall, SSH security
  - `docker` — Docker Engine and Compose installation
  - `deploy-user` — Non-login deploy user with SSH key and Docker access (blue-green mode)
  - `nginx` — nginx, certbot SSL/TLS, site config templating
  - `app-deploy` — Application setup: copy compose files, health checks, deploy script
  - `postgres-backup` — Optional automated PostgreSQL backups to R2 (Cloudflare)

- **`inventory/`** — Host definitions and variables
  - `emit-vision.example.yml` — Reference example showing all blue-green variables

## Quick Start

### First Provision of a New Server

1. Copy the example inventory and edit with your server details:
   ```bash
   cp ansible/inventory/emit-vision.example.yml ansible/inventory/emit-vision.yml
   # Edit ansible/inventory/emit-vision.yml with actual IP, domain, compose file paths, SSH key, etc.
   ```

2. Ensure your control machine has Ansible installed:
   ```bash
   pip install ansible
   ```

3. Run the provisioning playbook:
   ```bash
   ansible-playbook -i ansible/inventory/emit-vision.yml ansible/playbooks/provision.yml
   ```

This will:
- Install and configure Docker, nginx, certbot
- Create a non-login `deploy` user (if `deploy_public_key` is set)
- Copy docker-compose files and app directory structure
- Obtain SSL certificates from Let's Encrypt (certbot)
- For blue-green projects: start both blue and green compose stacks on their port ranges, create nginx upstream configs, install the deploy script

### Re-deploy an Application

```bash
# Deploy using the provisioned setup (pull latest images, restart containers)
ansible-playbook -i ansible/inventory/emit-vision.yml ansible/playbooks/deploy.yml
```

For blue-green projects, this runs the standard deploy; use the on-server script for zero-downtime deploys:
```bash
ssh deploy@<server-ip> /opt/emit-vision/blue-green-deploy.sh
```

## Variable Reference

| Variable | Type | Default | Required | Description |
|----------|------|---------|----------|-------------|
| **Connection & Identity** |
| `ansible_host` | string | — | ✓ | Server IP or hostname |
| `ansible_user` | string | `root` | ✓ | SSH user (must have sudo permissions) |
| `project_name` | string | — | ✓ | Project identifier (docker prefix, app dir, nginx site name) |
| **Domain & TLS** |
| `domain` | string | — | ✓ | Primary domain (used by nginx and certbot) |
| `nginx_wildcard_cert` | bool | `false` | — | Request wildcard cert via Cloudflare DNS-01 challenge |
| `cloudflare_api_token` | string | — | if `nginx_wildcard_cert` | Cloudflare API token for DNS-01 cert renewal |
| `nginx_ssl` | bool | `true` | — | Enable HTTPS server blocks (disable for local/test environments without certs) |
| `nginx_www` | bool | `true` | — | Include `www.{{ domain }}` in nginx server blocks |
| **Blue-Green Deployment** |
| `blue_green` | bool | `false` | — | Enable blue-green dual-slot deploy mode with zero-downtime capability |
| `blue_green_compose_files` | list | `[]` | if `blue_green` | Local paths to compose files to copy: `docker-compose.app.yml`, `.blue.yml`, `.green.yml`, `.infra.yml` |
| `deploy_public_key` | string | — | if `blue_green` | SSH public key (ed25519 or RSA) to install in `~deploy/.ssh/authorized_keys` |
| `blue_web_port` | int | `4300` | — | Blue slot web service port |
| `blue_api_port` | int | `4301` | — | Blue slot API service port |
| `blue_worker_port` | int | `4302` | — | Blue slot worker service port |
| `blue_marketing_port` | int | `4303` | — | Blue slot marketing service port |
| **Health Checks** |
| `health_check_retries` | int | `10` | — | Number of retries for health checks during deploy |
| `health_check_path` | string | `/` | — | HTTP path for health checks (e.g., `/`, `/health`, `/readyz`) |
| `health_check_backoff` | int | `3` | — | Delay (seconds) between health check retries |
| **Application Configuration** |
| `env_src` | string | `.env` | if `copy_env` | Local path to `.env` file to copy to server |
| `copy_env` | bool | `false` | — | Whether to copy the `.env` file during provisioning |
| `compose_dest` | string | `docker-compose.yml` | — | Filename in app directory for the default compose file |
| `post_deploy_exec` | list | `[]` | — | Commands to run after deploy (e.g., migrations, cache warming) |
| **PostgreSQL Backups (Optional)** |
| `postgres_backup_bucket` | string | — | — | R2 bucket name for automated backups (triggers postgres-backup role if set) |
| `postgres_backup_schedule` | string | `0 2 * * *` | — | Cron schedule for backups (default: daily at 2 AM UTC) |
| **Deploy Strategy (Optional)** |
| `zero_downtime` | bool | `false` | — | Use zero-downtime deploy (app-deploy role): start standby container, health-check, nginx swap |
| `nginx_api_port` | int | — | — | If set, create an `api.{{ domain }}` nginx server block (automatic for blue-green) |

## Inventory Example

See `ansible/inventory/emit-vision.example.yml` for a fully commented example with:
- Host definition with connection details
- All blue-green variables with inline documentation
- Environment and application configuration examples
- Optional features (backups, zero-downtime deploy)

Copy and customize this file for your project:
```bash
cp ansible/inventory/emit-vision.example.yml ansible/inventory/<your-project>.yml
```

## Pre-Production Verification Checklist

After provisioning or deploying, verify the setup with this checklist (see sprint 34 for details):

- [ ] SSH to the server as the `deploy` user (if blue-green)
- [ ] Verify nginx config: `sudo nginx -t`
- [ ] Check SSL certificate: `sudo certbot certificates`
- [ ] Verify docker containers are running: `docker ps`
- [ ] Test health checks: `curl http://localhost:4300/` (blue web) and `http://localhost:4301/readyz` (blue api)
- [ ] Check nginx is routing correctly: `curl https://<domain>/` (should return 200/healthy response)
- [ ] Verify `.active-slot` file exists: `cat /opt/<project>/.active-slot`
- [ ] Test blue-green deploy script (on-server): `/opt/<project>/blue-green-deploy.sh`

## Common Issues

### Compose files not found during provisioning

Ensure `blue_green_compose_files` paths are absolute and relative to the **Ansible control machine** (where you run the playbook), not the target server. Example:

```yaml
blue_green_compose_files:
  - "/Users/alice/emit-vision/docker-compose.app.yml"
  - "/Users/alice/emit-vision/docker-compose.blue.yml"
  - "/Users/alice/emit-vision/docker-compose.green.yml"
  - "/Users/alice/emit-vision/docker-compose.infra.yml"
```

### Deploy user cannot access /opt/emit-vision

Check that the `deploy` user was created and the directory is owned by them:
```bash
sudo ls -la /opt/emit-vision
# Should show: deploy:deploy 0755
sudo id deploy
# Should include: groups=...(docker)...
```

### SSL certificates not auto-renewed

The nginx role sets up a weekly cron job for `certbot renew`. Verify it:
```bash
sudo crontab -l | grep certbot
```

For wildcard certs (DNS-01), ensure the Cloudflare API token is valid and the cron environment has access to it.

## Further Reading

- **Sprint 33**: Blue-green Ansible provisioning (dual-stack compose, deploy user, infra stack)
- **Sprint 34**: Blue-green SSL/HTTPS support in nginx templates
- **Sprint 35**: emit-vision CI workflow_call migration (automated provisioning trigger)
- **Blue-Green Deploy Script**: `/opt/<project>/blue-green-deploy.sh` (installed during blue-green provisioning)

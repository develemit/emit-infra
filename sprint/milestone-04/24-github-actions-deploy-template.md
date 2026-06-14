# Scaffold GitHub Actions deploy workflow in `init`
**Difficulty:** 3

## Goal
`emit-infra init <name>` scaffolds `.github/workflows/deploy.yml` alongside
the existing `.emit-infra.json` and `terraform/` files — a ready-to-use
CI/CD pipeline that builds a Docker image, pushes to GHCR, and SSH-deploys
to the provisioned server.

## Reason
`emit-infra setup` already pushes `SERVER_IP` and `SSH_PRIVATE_KEY` to GitHub
secrets, but each project currently hand-writes its own Actions workflow to use
them. There's no canonical template, so patterns diverge across projects (some
restart correctly, some don't prune old images, some miss the health check
window). Scaffolding a standard workflow at `init` time means new projects
start with the right pattern instead of each team member improvising one.

## Context
- `apps/cli/src/commands/init.ts` — scaffolds `.emit-infra.json` and
  `terraform/`. Add `.github/workflows/deploy.yml` to the same function.
  Create the directory if it doesn't exist (`mkdirSync` with `recursive: true`).
- `config.github.repo` in `.emit-infra.json` is in `owner/repo` format —
  derive the GHCR image name as `ghcr.io/${config.github.repo}`.
- The workflow uses `GITHUB_TOKEN` (auto-provided) to push to GHCR.
  It uses `SERVER_IP` and `SSH_PRIVATE_KEY` secrets (pushed by `emit-infra setup`).
- Keep the workflow parametric: inject `config.name`, `config.github.repo`,
  and optionally `config.deploy?.appDir` (defaults to `/opt/${name}`) via
  template interpolation in `buildWorkflow(config)`.

### Workflow shape

```yaml
name: Deploy

on:
  push:
    branches: [main]

env:
  IMAGE: ghcr.io/{owner}/{repo}

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Log in to GHCR
        uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          push: true
          tags: ${{ env.IMAGE }}:latest,${{ env.IMAGE }}:${{ github.sha }}
          build-args: |
            BUILD_NUMBER=${{ github.run_number }}
          labels: |
            build.number=${{ github.run_number }}

      - name: Deploy to server
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.SERVER_IP }}
          username: root
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd {appDir}
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f
            echo "${{ github.run_number }}" > {appDir}/.deployed-version
```

Notes:
- `BUILD_NUMBER` build-arg and `build.number` label wire into the existing
  build-number tracking (`app-deploy/tasks/main.yml` reads the label from
  the running container to write `.deployed-version`). The workflow also writes
  `.deployed-version` directly via SSH as a belt-and-suspenders fallback.
- `appleboy/ssh-action@v1` handles the SSH private key automatically — no need
  to write key files manually.
- Do not include `zero_downtime` logic in the workflow template — that runs via
  Ansible on the developer's machine. The CI workflow does the simple pull+up
  pattern.

## Tasks

1. Add a `buildWorkflow(config: ProjectConfig): string` function to `init.ts`
   that returns the YAML string above, interpolating:
   - `{owner}/{repo}` from `config.github.repo`
   - `{appDir}` from `config.deploy?.appDir ?? `/opt/${config.name}``

2. In the `registerInit` action, after writing `terraform/`, write the workflow:
   ```ts
   const workflowDir = join(process.cwd(), '.github', 'workflows')
   if (!existsSync(workflowDir)) mkdirSync(workflowDir, { recursive: true })
   const workflowPath = join(workflowDir, 'deploy.yml')
   if (!existsSync(workflowPath)) {
     writeFileSync(workflowPath, buildWorkflow(config as ProjectConfig))
     console.log(chalk.green(`Created .github/workflows/deploy.yml`))
   }
   ```
   Guard with `existsSync` — never overwrite a workflow the developer may have
   customised.

3. Update the "Next steps" output at the end of `registerInit` to mention the
   workflow:
   ```
   Push to GitHub to trigger the deploy workflow
   ```

4. Run `pnpm tsc --noEmit -p apps/cli/tsconfig.json` — confirm clean.

## Files involved

- `apps/cli/src/commands/init.ts` — add `buildWorkflow()` function and write call

## Acceptance criteria

- [x] `emit-infra init <name>` creates `.github/workflows/deploy.yml`
- [x] The workflow references the correct GHCR image path derived from `config.github.repo`
- [x] The workflow references `SERVER_IP` and `SSH_PRIVATE_KEY` secrets
- [x] Re-running `init` does not overwrite an existing `deploy.yml`
- [x] TypeScript compiles clean

## Completed

**Date:** 2026-06-06

### Summary
Added `buildWorkflow(config)` function to `init.ts` that generates a GitHub Actions
deploy workflow YAML. The workflow builds a Docker image, pushes to GHCR using the
auto-provided `GITHUB_TOKEN`, and SSH-deploys to the server using `SERVER_IP` and
`SSH_PRIVATE_KEY` secrets. The GHCR image path is derived from `config.github.repo`
and the app directory defaults to `/opt/${config.name}` unless `config.deploy.appDir`
is set. The workflow file is only written if it doesn't already exist, preventing
overwrites of customized workflows.

### Files changed
- `apps/cli/src/commands/init.ts` — added `buildWorkflow()` function and workflow file creation after terraform scaffolding; added deploy workflow mention to next-steps output

### Verification
- `pnpm tsc --noEmit -p apps/cli/tsconfig.json`: clean
- Code inspection: all 5 acceptance criteria verified against the implementation

### Follow-ups
- none

## Out of scope

- Multi-environment workflows (staging/production branches)
- Self-hosted runners
- Zero-downtime deploy in the CI workflow (that's Ansible-based, for the CLI)
- Docker layer caching (useful but not part of baseline)

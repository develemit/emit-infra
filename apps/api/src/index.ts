import Fastify from 'fastify'
import cors from '@fastify/cors'
import { projectRoutes } from './routes/projects.js'
import { projectStatusRoutes } from './routes/project-status.js'
import { projectDockerRoutes } from './routes/project-docker.js'
import { projectBackupsRoutes } from './routes/project-backups.js'
import { operationRoutes } from './routes/operations.js'
import { rollbackRoutes } from './routes/rollback.js'
import { secretsSyncRoutes } from './routes/secrets-sync.js'
import { opsRoutes } from './routes/ops.js'
import { billingRoutes } from './routes/billing.js'
import { pushRoutes } from './routes/push.js'
import { historyRoutes } from './routes/history.js'
import { reliabilityRoutes } from './routes/reliability.js'
import { incidentsExportRoutes } from './routes/incidents-export.js'
import { incidentAnnotationRoutes } from './routes/incident-annotations.js'
import { fleetRoutes } from './routes/fleet.js'
import { diskRoutes } from './routes/disk.js'
import { postgresRoutes } from './routes/postgres.js'
import { cronRoutes } from './routes/cron.js'
import { ufwRoutes } from './routes/ufw.js'
import { secretsRoutes } from './routes/secrets.js'
import { nginxConfigRoutes } from './routes/nginx-config.js'
import { responseTimeRoutes } from './routes/response-times.js'
import { certRoutes } from './routes/cert.js'
import { costRoutes } from './routes/cost.js'
import { containerLogsRoutes } from './routes/container-logs.js'
import { nginxEndpointsRoutes } from './routes/nginx-endpoints.js'
import { scaleAdviceRoutes } from './routes/scale-advice.js'
import { alertsRoutes } from './routes/alerts.js'
import { deployRoutes } from './routes/deploy.js'
import { startStatusMonitor } from './lib/status-monitor.js'
import { startDigestScheduler } from './lib/digest-scheduler.js'
import { registerAuth } from './lib/auth.js'
import { formatFatalError } from './lib/fatal.js'

const app = Fastify({ logger: process.env['NODE_ENV'] === 'development' ? { level: 'warn' } : true })

await app.register(cors, { origin: '*', allowedHeaders: ['Content-Type', 'Authorization'] })

registerAuth(app, process.env['API_SECRET'])

app.get('/health', async () => ({ ok: true }))

await app.register(projectRoutes)
await app.register(projectStatusRoutes)
await app.register(projectDockerRoutes)
await app.register(projectBackupsRoutes)
await app.register(operationRoutes)
await app.register(rollbackRoutes)
await app.register(secretsSyncRoutes)
await app.register(opsRoutes)
await app.register(billingRoutes)
await app.register(pushRoutes)
await app.register(historyRoutes)
await app.register(reliabilityRoutes)
await app.register(incidentsExportRoutes)
await app.register(incidentAnnotationRoutes)
await app.register(fleetRoutes)
await app.register(diskRoutes)
await app.register(postgresRoutes)
await app.register(cronRoutes)
await app.register(ufwRoutes)
await app.register(secretsRoutes)
await app.register(nginxConfigRoutes)
await app.register(responseTimeRoutes)
await app.register(certRoutes)
await app.register(costRoutes)
await app.register(containerLogsRoutes)
await app.register(nginxEndpointsRoutes)
await app.register(scaleAdviceRoutes)
await app.register(alertsRoutes)
await app.register(deployRoutes)

process.on('unhandledRejection', (reason, promise) => {
  app.log.error({ err: reason, promise }, 'Unhandled rejection')
})

// Unlike unhandledRejection above (log and keep running), an uncaught throw
// leaves the process in an undefined state per Node's own guidance — the
// safe move is to log richly and exit, letting the sprint-310 supervisor
// (scripts/serve-supervised.sh, wired in via the `dev` target) start a clean
// process and record the death. develemit-hq's server.ts deliberately does
// the opposite (swallows uncaughtException and keeps running) because it has
// no supervisor wrapping it yet — don't "fix" this file to match; they're
// intentionally different until develemit-hq gets its own supervisor.
process.on('uncaughtException', (err) => {
  const { message, stack } = formatFatalError(err)
  app.log.fatal({ err, stack }, `Uncaught exception: ${message}`)
  process.exit(1)
})

const port = Number(process.env['PORT'] ?? 7001)
const isDev = process.env['NODE_ENV'] === 'development'
const hasSecret = Boolean(process.env['API_SECRET'])
const host = !hasSecret && !isDev ? '127.0.0.1' : '0.0.0.0'
if (!hasSecret && !isDev) {
  app.log.warn('API_SECRET not set — binding to localhost only; destructive endpoints would otherwise be open to the network')
}
await app.listen({ port, host })
startStatusMonitor()
startDigestScheduler()

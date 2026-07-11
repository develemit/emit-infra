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
import { incidentsExportRoutes } from './routes/incidents-export.js'
import { incidentAnnotationRoutes } from './routes/incident-annotations.js'
import { fleetRoutes } from './routes/fleet.js'
import { diskRoutes } from './routes/disk.js'
import { postgresRoutes } from './routes/postgres.js'
import { cronRoutes } from './routes/cron.js'
import { ufwRoutes } from './routes/ufw.js'
import { secretsRoutes } from './routes/secrets.js'
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
await app.register(incidentsExportRoutes)
await app.register(incidentAnnotationRoutes)
await app.register(fleetRoutes)
await app.register(diskRoutes)
await app.register(postgresRoutes)
await app.register(cronRoutes)
await app.register(ufwRoutes)
await app.register(secretsRoutes)
await app.register(responseTimeRoutes)
await app.register(certRoutes)
await app.register(costRoutes)
await app.register(containerLogsRoutes)
await app.register(nginxEndpointsRoutes)
await app.register(scaleAdviceRoutes)
await app.register(alertsRoutes)
await app.register(deployRoutes)

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

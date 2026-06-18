import Fastify from 'fastify'
import cors from '@fastify/cors'
import { projectRoutes } from './routes/projects.js'
import { operationRoutes } from './routes/operations.js'
import { rollbackRoutes } from './routes/rollback.js'
import { secretsSyncRoutes } from './routes/secrets-sync.js'
import { opsRoutes } from './routes/ops.js'
import { billingRoutes } from './routes/billing.js'
import { pushRoutes } from './routes/push.js'
import { historyRoutes } from './routes/history.js'
import { startStatusMonitor } from './lib/status-monitor.js'

const app = Fastify({ logger: true })

await app.register(cors, { origin: '*' })
await app.register(projectRoutes)
await app.register(operationRoutes)
await app.register(rollbackRoutes)
await app.register(secretsSyncRoutes)
await app.register(opsRoutes)
await app.register(billingRoutes)
await app.register(pushRoutes)
await app.register(historyRoutes)

const port = Number(process.env['PORT'] ?? 7001)
await app.listen({ port, host: '0.0.0.0' })
startStatusMonitor()

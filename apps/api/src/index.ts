import Fastify from 'fastify'
import cors from '@fastify/cors'
import { projectRoutes } from './routes/projects.js'
import { operationRoutes } from './routes/operations.js'
import { opsRoutes } from './routes/ops.js'
import { billingRoutes } from './routes/billing.js'

const app = Fastify({ logger: true })

await app.register(cors, { origin: '*' })
await app.register(projectRoutes)
await app.register(operationRoutes)
await app.register(opsRoutes)
await app.register(billingRoutes)

const port = Number(process.env['PORT'] ?? 7001)
await app.listen({ port, host: '0.0.0.0' })

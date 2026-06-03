import Fastify from 'fastify'
import cors from '@fastify/cors'
import { projectRoutes } from './routes/projects.js'
import { operationRoutes } from './routes/operations.js'
import { opsRoutes } from './routes/ops.js'

if (!process.env['ANTHROPIC_API_KEY']) {
  console.error('[startup] ANTHROPIC_API_KEY is not set — Claude ops panel will be unavailable')
}

const app = Fastify({ logger: true })

await app.register(cors, { origin: '*' })
await app.register(projectRoutes)
await app.register(operationRoutes)
await app.register(opsRoutes)

const port = Number(process.env['PORT'] ?? 3001)
await app.listen({ port, host: '0.0.0.0' })

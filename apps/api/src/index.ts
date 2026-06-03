import Fastify from 'fastify'
import cors from '@fastify/cors'
import { projectRoutes } from './routes/projects.js'
import { operationRoutes } from './routes/operations.js'

const app = Fastify({ logger: true })

await app.register(cors, { origin: '*' })
await app.register(projectRoutes)
await app.register(operationRoutes)

const port = Number(process.env['PORT'] ?? 3001)
await app.listen({ port, host: '0.0.0.0' })

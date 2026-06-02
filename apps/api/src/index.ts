import Fastify from 'fastify'
import cors from '@fastify/cors'
import { projectRoutes } from './routes/projects.js'

const app = Fastify({ logger: true })

await app.register(cors, { origin: '*' })
await app.register(projectRoutes)

const port = Number(process.env['PORT'] ?? 3001)
await app.listen({ port, host: '0.0.0.0' })

import type { FastifyInstance, FastifyBaseLogger } from 'fastify'
import { join } from 'node:path'
import { appendFile } from 'node:fs/promises'
import { z } from 'zod'
import { findProject, SAFE_NAME_RE } from '../lib/project-helpers.js'
import { sendToAll } from '../lib/push.js'

interface DeployState {
  status: 'running' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string | undefined
  error?: string | undefined
  sha?: string | undefined
  branch?: string | undefined
  buildNumber?: string | undefined
}

const deployStates = new Map<string, DeployState>()

const BodySchema = z.object({
  sha: z.string().optional(),
  branch: z.string().optional(),
  buildNumber: z.string().optional(),
})

export async function deployRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { name: string } }>('/projects/:name/deploy', async (req, reply) => {
    const { name } = req.params
    if (!SAFE_NAME_RE.test(name)) return reply.status(400).send({ error: 'invalid project name' })

    const project = await findProject(name)
    if (!project) return reply.status(404).send({ error: 'not found' })

    const current = deployStates.get(name)
    if (current?.status === 'running') {
      return reply.status(409).send({ error: 'deploy already running', startedAt: current.startedAt })
    }

    const body = BodySchema.safeParse(req.body ?? {})
    const meta = body.success ? body.data : {}

    const state: DeployState = {
      status: 'running',
      startedAt: new Date().toISOString(),
      sha: meta.sha,
      branch: meta.branch,
      buildNumber: meta.buildNumber,
    }
    deployStates.set(name, state)

    runDeploy(name, project.projectDir, state, app.log).catch((err) =>
      app.log.error({ err, project: name }, 'runDeploy crashed'),
    )

    return reply.status(202).send({ status: 'accepted', startedAt: state.startedAt })
  })

}

async function runDeploy(name: string, projectDir: string, state: DeployState, log: FastifyBaseLogger): Promise<void> {
  try {
    const { execa } = await import('execa')
    await execa('npx', ['emit-infra', 'deploy', name], {
      cwd: projectDir,
      timeout: 300_000,
      env: { ...process.env, FORCE_COLOR: '0' },
    })

    state.status = 'completed'
    state.completedAt = new Date().toISOString()

    const startMs = new Date(state.startedAt).getTime()
    const endMs = new Date(state.completedAt).getTime()
    const durationSec = Math.round((endMs - startMs) / 1000)

    const historyEntry = {
      status: 'completed',
      sha: state.sha,
      branch: state.branch,
      buildNumber: state.buildNumber,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      durationSec,
      trigger: 'webhook' as const,
    }

    const historyPath = join(projectDir, '.deploy-history.jsonl')
    await appendFile(historyPath, JSON.stringify(historyEntry) + '\n').catch((err) =>
      log.warn({ err, project: name }, 'failed to write deploy history'),
    )

    await sendToAll({
      title: `${name}: deploy complete`,
      body: state.buildNumber ? `Build #${state.buildNumber} is live` : 'Deploy succeeded',
      tag: `deploy:${name}`,
      url: `/?p=${name}`,
    }).catch((err) =>
      log.warn({ err, project: name }, 'failed to send deploy push notification'),
    )
  } catch (err) {
    state.status = 'failed'
    state.completedAt = new Date().toISOString()
    state.error = err instanceof Error ? err.message : String(err)

    const startMs = new Date(state.startedAt).getTime()
    const endMs = new Date(state.completedAt).getTime()
    const durationSec = Math.round((endMs - startMs) / 1000)

    const historyEntry = {
      status: 'failed',
      sha: state.sha,
      branch: state.branch,
      buildNumber: state.buildNumber,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      durationSec,
      trigger: 'webhook' as const,
      error: state.error,
    }

    const historyPath = join(projectDir, '.deploy-history.jsonl')
    await appendFile(historyPath, JSON.stringify(historyEntry) + '\n').catch((histErr) =>
      log.warn({ err: histErr, project: name }, 'failed to write deploy history'),
    )

    await sendToAll({
      title: `${name}: deploy failed`,
      body: state.error,
      tag: `deploy:${name}`,
      url: `/?p=${name}`,
    }).catch((pushErr) =>
      log.warn({ err: pushErr, project: name }, 'failed to send deploy push notification'),
    )
  }
}

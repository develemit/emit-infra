import { z } from 'zod'

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  region: z.enum(['nbg1', 'fsn1', 'hel1', 'ash', 'hil']).default('nbg1'),
  serverType: z.string().default('cx22'),
  sshKeyName: z.string().default('emit-deploy'),
  serverIp: z.string().optional(),
  github: z.object({
    repo: z.string().regex(/^[^/]+\/[^/]+$/, 'Must be in owner/repo format'),
  }),
  r2: z
    .object({
      buckets: z.array(z.string()).default([]),
    })
    .optional(),
  upstash: z
    .object({
      region: z.string().default('us-east-1'),
    })
    .optional(),
  postgres: z
    .object({
      version: z.string().default('16'),
      backupBucket: z.string().optional(),
    })
    .optional(),
  nginx: z
    .object({
      wildcardCert: z.boolean().default(false),
      customConfigSrc: z.string().optional(),
    })
    .optional(),
  stripe: z
    .object({
      mode: z.enum(['test', 'live']).default('live'),
    })
    .optional(),
  deploy: z
    .object({
      appDir: z.string().default('/app'),
      composeSrc: z.string().default('docker-compose.yml'),
      composeDest: z.string().default('docker-compose.yml'),
      appPort: z.coerce.string().optional(),
      extraFiles: z
        .array(z.object({ src: z.string(), dest: z.string() }))
        .default([]),
      postDeployExec: z
        .array(z.object({ service: z.string(), command: z.string() }))
        .default([]),
    })
    .optional(),
})

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>

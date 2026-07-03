import { z } from 'zod'

const AlertRuleItemSchema = z.object({
  metric: z.enum(['diskPct', 'memPct', 'certDays', 'backupAgeHours']),
  op: z.enum(['gt', 'lt']),
  threshold: z.number(),
  enabled: z.boolean(),
})

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  region: z.enum(['nbg1', 'fsn1', 'hel1', 'ash', 'hil']).default('nbg1'),
  serverType: z.string().default('cx22'),
  sshKeyName: z.string().default('emit-deploy'),
  serverIp: z.string().optional(),
  healthCheck: z
    .object({
      url: z.string().url(),
    })
    .optional(),
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
      backupRetainDays: z.number().int().min(1).default(7),
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
  blueGreen: z
    .object({
      services: z.array(
        z.object({
          name: z.string(),
          bluePort: z.number().int(),
          greenPort: z.number().int(),
          healthPath: z.string().optional(),
        }),
      ),
      nginxConfPath: z.string().optional(),
      migratePre: z.string().optional(),
      migratePost: z.string().optional(),
      composeStructure: z.enum(['profiles', 'separate']).default('separate'),
    })
    .optional(),
  ci: z
    .object({
      preCommit: z.array(z.string()).default(['lint', 'typecheck']),
      prePush: z.array(z.string()).default(['lint', 'typecheck', 'test', 'build']),
      envFile: z.string().optional(),
      ghcrOrg: z.string(),
      ghcrRepo: z.string().optional(),
      imagePrefix: z.string().optional(),
      sshKey: z.string().default('~/.ssh/emit-deploy'),
      buildArgs: z
        .record(z.string(), z.array(z.object({ name: z.string(), env: z.string() })))
        .optional(),
      preDeploy: z.array(z.string()).optional(),
    })
    .optional(),
  requiredEnvKeys: z.string().array().optional(),
  warnThresholds: z
    .object({
      diskPct: z.number().int().min(1).max(100).optional(),
      memPct: z.number().int().min(1).max(100).optional(),
      backupAgeHours: z.number().int().min(1).optional(),
    })
    .optional(),
  alertRules: z.array(AlertRuleItemSchema).optional(),
})

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>

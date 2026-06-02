import { z } from 'zod'

export const ProjectConfigSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  region: z.enum(['nbg1', 'fsn1', 'hel1', 'ash', 'hil']).default('nbg1'),
  serverType: z.string().default('cx22'),
  sshKeyName: z.string().default('emit-deploy'),
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
})

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>

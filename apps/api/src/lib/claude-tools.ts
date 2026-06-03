import type Anthropic from '@anthropic-ai/sdk'

export const tools: Anthropic.Tool[] = [
  {
    name: 'list_projects',
    description: 'List all infrastructure projects managed by emit-infra.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_status',
    description: 'Get server status (uptime, disk %, memory %) for a project.',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'Project name' } },
      required: ['name'],
    },
  },
  {
    name: 'get_containers',
    description: 'List running Docker containers for a project.',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'Project name' } },
      required: ['name'],
    },
  },
  {
    name: 'get_logs',
    description: 'Collect up to 10 seconds of Docker Compose logs for a project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Project name' },
        service: { type: 'string', description: 'Optional service name filter' },
      },
      required: ['name'],
    },
  },
  {
    name: 'deploy',
    description: 'Deploy a project using Ansible. Requires user confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'Project name' } },
      required: ['name'],
    },
  },
  {
    name: 'provision',
    description: 'Provision infrastructure with Terraform. Requires user confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'Project name' } },
      required: ['name'],
    },
  },
  {
    name: 'destroy',
    description: 'Destroy all infrastructure for a project. IRREVERSIBLE. Requires confirmation.',
    input_schema: {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'Project name' } },
      required: ['name'],
    },
  },
]

export const sshCmd = (serverIp: string | undefined, cmd: string): string => `ssh root@${serverIp ?? '<serverIp>'} '${cmd}'`

export const URGENCY_RANK = { now: 0, soon: 1, watch: 2, none: 3 } as const

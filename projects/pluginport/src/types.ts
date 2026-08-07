export type Severity = 'high' | 'medium' | 'low' | 'info'

export const SEVERITY_ORDER: Severity[] = ['high', 'medium', 'low', 'info']

export const SEVERITY_RANK: Record<Severity, number> = {
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
}

export type Finding = {
  rule: string
  severity: Severity
  message: string
  fix: string
  file?: string
  meta?: Record<string, unknown>
}

export type PluginManifest = {
  $schema: string
  name: string
  version?: string
  description?: string
  author?: { name?: string; email?: string; url?: string }
  homepage?: string
  repository?: string
  license?: string
  keywords?: string[]
  extensions?: Record<string, Record<string, unknown>>
}

export type McpConfig = {
  $schema: string
  mcpServers: Record<string, McpServerConfig>
}

export type McpServerConfig = {
  type: 'stdio' | 'streamable-http' | 'sse'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
}

export type SkillFrontmatter = {
  name?: string
  description?: string
  [key: string]: unknown
}

export type CheckResult = {
  pluginDir: string
  pluginName?: string
  findings: Finding[]
  highCount: number
  clean: boolean
  summary: string
}

export type ClientProfile = {
  id: string
  label: string
  stdio: boolean
  streamableHttp: boolean
  sse: boolean
}

export const KNOWN_CLIENTS: ClientProfile[] = [
  { id: 'cursor', label: 'Cursor', stdio: true, streamableHttp: true, sse: true },
  { id: 'vscode', label: 'VS Code', stdio: true, streamableHttp: true, sse: true },
  { id: 'copilot', label: 'GitHub Copilot', stdio: true, streamableHttp: true, sse: false },
  { id: 'chatgpt', label: 'ChatGPT / Codex', stdio: true, streamableHttp: true, sse: false },
  { id: 'kiro', label: 'Kiro (AWS)', stdio: true, streamableHttp: true, sse: true },
]

export type CompatRow = {
  client: string
  status: 'ok' | 'warn' | 'fail'
  notes: string[]
}

export type CompatResult = {
  pluginDir: string
  pluginName?: string
  transports: string[]
  rows: CompatRow[]
  findings: Finding[]
}

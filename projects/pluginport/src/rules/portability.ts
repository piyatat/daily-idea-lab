import type { ClientProfile, CompatResult, CompatRow, Finding, McpConfig } from '../types.js'
import { KNOWN_CLIENTS } from '../types.js'

function collectTransports(mcp: McpConfig | null): string[] {
  if (!mcp) return []
  const set = new Set<string>()
  for (const server of Object.values(mcp.mcpServers)) {
    set.add(server.type)
  }
  return [...set]
}

function evaluateClient(
  client: ClientProfile,
  transports: string[],
  hasSkills: boolean,
  hasMcp: boolean,
): CompatRow {
  const notes: string[] = []
  let status: CompatRow['status'] = 'ok'

  if (transports.length === 0 && !hasSkills) {
    return { client: client.label, status: 'fail', notes: ['Plugin has no skills/ or mcp.json servers.'] }
  }

  if (hasMcp) {
    const onlySse = transports.length === 1 && transports[0] === 'sse'
    if (onlySse) {
      status = 'fail'
      notes.push('Plugin uses sse-only MCP — Copilot/ChatGPT may not connect.')
    }

    for (const t of transports) {
      if (t === 'stdio' && !client.stdio) {
        status = 'fail'
        notes.push('Requires stdio MCP (unsupported).')
      }
      if (t === 'streamable-http' && !client.streamableHttp) {
        status = 'fail'
        notes.push('Requires streamable-http MCP (unsupported).')
      }
      if (t === 'sse' && !client.sse && transports.includes('sse')) {
        if (status === 'ok') status = 'warn'
        notes.push('Uses deprecated sse transport (optional client support).')
      }
    }

    if (transports.includes('stdio') && transports.includes('streamable-http')) {
      notes.push('Dual transport — broad client coverage.')
    } else if (transports.includes('stdio')) {
      if (status === 'ok') status = 'warn'
      notes.push('stdio-only — remote-only clients may skip MCP.')
    } else if (transports.includes('streamable-http')) {
      if (status === 'ok') status = 'warn'
      notes.push('streamable-http-only — sandboxed stdio clients may skip MCP.')
    }
  } else if (hasSkills) {
    notes.push('Skills-only plugin — portable across all listed clients.')
  }

  if (notes.length === 0) notes.push('Compatible with declared transports.')
  return { client: client.label, status, notes }
}

export function checkPortability(
  pluginRoot: string,
  mcp: McpConfig | null,
  hasSkills: boolean,
  clients: ClientProfile[] = KNOWN_CLIENTS,
): CompatResult {
  const transports = collectTransports(mcp)
  const hasMcp = transports.length > 0
  const rows = clients.map((c) => evaluateClient(c, transports, hasSkills, hasMcp))

  const findings: Finding[] = []
  if (transports.length === 1 && transports[0] === 'sse') {
    findings.push({
      rule: 'portability',
      severity: 'high',
      file: 'mcp.json',
      message: 'Plugin relies solely on deprecated sse transport.',
      fix: 'Add stdio or streamable-http MCP servers for cross-client portability.',
    })
  }

  if (hasMcp && !transports.includes('stdio') && !transports.includes('streamable-http')) {
    findings.push({
      rule: 'portability',
      severity: 'high',
      file: 'mcp.json',
      message: 'No stdio or streamable-http MCP server declared.',
      fix: 'Agent Plugins conformant clients require at least one of stdio or streamable-http.',
    })
  }

  return {
    pluginDir: pluginRoot,
    transports,
    rows,
    findings,
  }
}

export function filterClients(ids: string[]): ClientProfile[] {
  if (ids.length === 0) return KNOWN_CLIENTS
  const set = new Set(ids.map((s) => s.toLowerCase()))
  const filtered = KNOWN_CLIENTS.filter((c) => set.has(c.id))
  return filtered.length > 0 ? filtered : KNOWN_CLIENTS
}

export { collectTransports }

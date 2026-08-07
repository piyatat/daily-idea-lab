import type { Finding, McpConfig } from '../types.js'

const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /Bearer\s+[A-Za-z0-9._-]{8,}/i, label: 'Bearer token' },
  { re: /\bsk-[A-Za-z0-9]{16,}\b/, label: 'API key (sk-*)' },
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/, label: 'GitHub token' },
  { re: /\b(xox[baprs]-|xapp-)[A-Za-z0-9-]{10,}\b/, label: 'Slack token' },
  { re: /(?:api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9._-]{8,}/i, label: 'credential assignment' },
]

function scanValue(value: string, context: string, file: string): Finding[] {
  const findings: Finding[] = []
  for (const { re, label } of SECRET_PATTERNS) {
    if (re.test(value)) {
      findings.push({
        rule: 'secrets',
        severity: 'high',
        file,
        message: `${context} may embed a ${label}.`,
        fix: 'Remove secrets from the plugin package; use client-managed auth or env injection at runtime.',
      })
    }
  }
  return findings
}

function isLoopback(url: string): boolean {
  try {
    const u = new URL(url)
    return u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '::1'
  } catch {
    return false
  }
}

export function checkSecrets(mcp: McpConfig | null, mcpFile: string): Finding[] {
  if (!mcp) return []
  const findings: Finding[] = []

  for (const [name, server] of Object.entries(mcp.mcpServers)) {
    const ctx = `mcpServers.${name}`

    if (server.url) {
      if (server.url.startsWith('http://') && !isLoopback(server.url)) {
        findings.push({
          rule: 'secrets',
          severity: 'high',
          file: mcpFile,
          message: `${ctx}.url uses plaintext HTTP for non-loopback host: ${server.url}`,
          fix: 'Use https:// for remote MCP endpoints.',
        })
      }
      findings.push(...scanValue(server.url, `${ctx}.url`, mcpFile))
    }

    if (server.headers) {
      for (const [key, val] of Object.entries(server.headers)) {
        findings.push(...scanValue(val, `${ctx}.headers.${key}`, mcpFile))
        if (/authorization|api-key|x-api-key/i.test(key) && val.length > 0 && val !== '${ENV:...}') {
          findings.push({
            rule: 'secrets',
            severity: 'medium',
            file: mcpFile,
            message: `${ctx}.headers.${key} contains a literal auth header value.`,
            fix: 'Let the client inject credentials; avoid static auth headers in mcp.json.',
          })
        }
      }
    }

    if (server.env) {
      for (const [key, val] of Object.entries(server.env)) {
        findings.push(...scanValue(val, `${ctx}.env.${key}`, mcpFile))
      }
    }
  }

  return findings
}

import { basename } from 'node:path'
import type { CheckResult, CompatResult, Finding, Severity } from './types.js'
import { SEVERITY_ORDER } from './types.js'

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
}

function colorize(enabled: boolean, color: string, text: string): string {
  if (!enabled) return text
  return `${color}${text}${COLORS.reset}`
}

function severityColor(sev: Severity): string {
  switch (sev) {
    case 'high':
      return COLORS.red
    case 'medium':
      return COLORS.yellow
    case 'low':
      return COLORS.cyan
    default:
      return COLORS.dim
  }
}

function padSev(sev: Severity): string {
  return sev.toUpperCase().padEnd(6, ' ')
}

export type ReportBundle = CheckResult & { version: string }

export function formatCheckText(bundle: ReportBundle, color: boolean): string {
  const c = (col: string, t: string) => colorize(color, col, t)
  const lines: string[] = []

  lines.push('')
  lines.push(
    c(COLORS.bold, 'pluginport') +
      c(COLORS.dim, ` · v${bundle.version} · Agent Plugins 1.0.0 linter`),
  )
  lines.push(
    c(COLORS.dim, basename(bundle.pluginDir)) +
      (bundle.pluginName ? c(COLORS.bold, ` · ${bundle.pluginName}`) : ''),
  )
  lines.push('')

  if (bundle.clean) {
    lines.push(c(COLORS.green, '✓ clean') + '  ' + c(COLORS.dim, bundle.summary))
    lines.push('')
    return lines.join('\n')
  }

  const status =
    bundle.highCount > 0
      ? c(COLORS.red, `${bundle.highCount} high`)
      : c(COLORS.yellow, 'warnings')
  lines.push(`${status}  ${c(COLORS.dim, bundle.summary)}`)
  lines.push('')
  lines.push(...formatFindingLines(bundle.findings, color, 1))
  lines.push(
    bundle.highCount > 0
      ? c(COLORS.dim, 'Exit 1 — high-severity findings present.')
      : c(COLORS.dim, 'Exit 0 — no high-severity findings.'),
  )
  lines.push('')
  return lines.join('\n')
}

function formatFindingLines(findings: Finding[], color: boolean, startIndex: number): string[] {
  const c = (col: string, t: string) => colorize(color, col, t)
  const lines: string[] = []
  let i = startIndex
  for (const f of findings) {
    const sev = c(severityColor(f.severity), padSev(f.severity))
    const rule = c(COLORS.dim, f.rule)
    lines.push(`${c(COLORS.dim, String(i).padStart(2, ' '))}. ${sev} ${rule}`)
    lines.push(`    ${f.message}`)
    lines.push(`    ${c(COLORS.cyan, 'fix:')} ${f.fix}`)
    if (f.file) lines.push(`    ${c(COLORS.dim, f.file)}`)
    lines.push('')
    i++
  }
  return lines
}

export function formatCheckJson(bundle: ReportBundle): string {
  const counts: Partial<Record<Severity, number>> = {}
  for (const f of bundle.findings) {
    counts[f.severity] = (counts[f.severity] ?? 0) + 1
  }

  return JSON.stringify(
    {
      version: bundle.version,
      pluginDir: bundle.pluginDir,
      pluginName: bundle.pluginName,
      clean: bundle.clean,
      highCount: bundle.highCount,
      summary: bundle.summary,
      severityCounts: Object.fromEntries(
        SEVERITY_ORDER.filter((s) => counts[s]).map((s) => [s, counts[s]]),
      ),
      findings: bundle.findings,
    },
    null,
    2,
  )
}

export function formatCompatText(result: CompatResult & { version: string }, color: boolean): string {
  const c = (col: string, t: string) => colorize(color, col, t)
  const lines: string[] = []

  lines.push('')
  lines.push(
    c(COLORS.bold, 'pluginport compat') +
      c(COLORS.dim, ` · v${result.version} · portability matrix`),
  )
  lines.push(
    c(COLORS.dim, basename(result.pluginDir)) +
      (result.pluginName ? c(COLORS.bold, ` · ${result.pluginName}`) : ''),
  )
  if (result.transports.length) {
    lines.push(c(COLORS.dim, `MCP transports: ${result.transports.join(', ')}`))
  } else {
    lines.push(c(COLORS.dim, 'No MCP servers declared'))
  }
  lines.push('')

  const header = `${'Client'.padEnd(18)} Status   Notes`
  lines.push(c(COLORS.bold, header))
  lines.push(c(COLORS.dim, '-'.repeat(header.length)))

  for (const row of result.rows) {
    const status =
      row.status === 'ok'
        ? c(COLORS.green, 'ok  ')
        : row.status === 'warn'
          ? c(COLORS.yellow, 'warn')
          : c(COLORS.red, 'fail')
    lines.push(`${row.client.padEnd(18)} ${status}   ${row.notes.join('; ')}`)
  }

  if (result.findings.length > 0) {
    lines.push('')
    lines.push(c(COLORS.bold, 'Portability findings'))
    lines.push('')
    lines.push(...formatFindingLines(result.findings, color, 1))
  }

  lines.push('')
  return lines.join('\n')
}

export function formatCompatJson(result: CompatResult & { version: string }): string {
  return JSON.stringify(result, null, 2)
}

#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  formatCheckJson,
  formatCheckText,
  formatCompatJson,
  formatCompatText,
  type ReportBundle,
} from './report.js'
import { SEVERITY_RANK, type Severity } from './types.js'
import { checkPlugin, compatPlugin } from './validate.js'

type CheckArgs = {
  command: 'check' | 'compat'
  target: string
  json: boolean
  help: boolean
  version: boolean
  color: boolean | 'auto'
  strict: boolean
  failOn: Severity
  clients: string[]
}

function packageVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }
  return pkg.version
}

function parseArgs(argv: string[]): CheckArgs {
  const args: CheckArgs = {
    command: 'check',
    target: '',
    json: false,
    help: false,
    version: false,
    color: 'auto',
    strict: false,
    failOn: 'high',
    clients: [],
  }

  const positionals: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--version' || a === '-V') args.version = true
    else if (a === '--json') args.json = true
    else if (a === '--color') args.color = true
    else if (a === '--no-color') args.color = false
    else if (a === '--strict') args.strict = true
    else if (a === '--fail-on') {
      const raw = (argv[++i] ?? '').toLowerCase()
      if (raw !== 'high' && raw !== 'medium' && raw !== 'low' && raw !== 'info') {
        throw new Error(
          `Invalid --fail-on: ${raw || '(empty)'}. Use high, medium, low, or info.\nTry: pluginport --help`,
        )
      }
      args.failOn = raw
    } else if (a === '--clients') {
      const raw = argv[++i] ?? ''
      args.clients = raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    } else if (a.startsWith('-')) {
      throw new Error(`Unknown flag: ${a}\nTry: pluginport --help`)
    } else {
      positionals.push(a)
    }
  }

  if (positionals[0] === 'check' || positionals[0] === 'compat') {
    args.command = positionals[0]
    positionals.shift()
  }

  if (positionals.length > 1) {
    throw new Error(`Unexpected extra arguments: ${positionals.slice(1).join(' ')}\nTry: pluginport --help`)
  }
  args.target = positionals[0] ?? ''
  return args
}

function help(): string {
  const v = packageVersion()
  return `
pluginport ${v} — pre-publish linter for Agent Plugins 1.0.0 packages

Usage:
  pluginport check [options] <plugin-dir>
  pluginport compat [options] <plugin-dir>

Commands:
  check                  Validate plugin.json, mcp.json, skills/, security, portability
  compat                 Print cross-client MCP transport compatibility matrix

Options:
  --json                 Machine-readable JSON report
  --strict               Treat medium/low findings as high severity
  --fail-on LEVEL        Exit 1 when any finding at LEVEL or worse (default: high)
  --clients LIST         Comma-separated client ids for compat (cursor,vscode,copilot,chatgpt,kiro)
  --color / --no-color   Force ANSI colors on or off
  -h, --help             Show help
  -V, --version          Show version

Exit codes:
  0  No findings at --fail-on severity or worse
  1  One or more findings at the fail threshold (or usage error)

Examples:
  pluginport check fixtures/valid-plugin
  pluginport check --json fixtures/invalid-plugin
  pluginport compat fixtures/valid-plugin --clients cursor,copilot
`.trimStart()
}

function wantColor(flag: boolean | 'auto', json: boolean): boolean {
  if (json) return false
  if (flag === true) return true
  if (flag === false) return false
  return Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
}

function defaultFixture(): string {
  return resolve('fixtures/valid-plugin')
}

async function main(): Promise<number> {
  let args: CheckArgs
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    return 1
  }

  if (args.help) {
    console.log(help())
    return 0
  }
  if (args.version) {
    console.log(packageVersion())
    return 0
  }

  const target = args.target ? resolve(args.target) : defaultFixture()
  const version = packageVersion()
  const color = wantColor(args.color, args.json)

  if (args.command === 'compat') {
    const result = compatPlugin(target, args.clients)
    const bundle = { ...result, version }
    if (args.json) console.log(formatCompatJson(bundle))
    else console.log(formatCompatText(bundle, color))

    const threshold = SEVERITY_RANK[args.failOn]
    const failCount = result.findings.filter((f) => SEVERITY_RANK[f.severity] >= threshold).length
    return failCount > 0 ? 1 : 0
  }

  const check = checkPlugin(target, { strict: args.strict })
  const bundle: ReportBundle = { ...check, version }

  if (args.json) console.log(formatCheckJson(bundle))
  else console.log(formatCheckText(bundle, color))

  const threshold = SEVERITY_RANK[args.failOn]
  const failCount = check.findings.filter((f) => SEVERITY_RANK[f.severity] >= threshold).length
  return failCount > 0 ? 1 : 0
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err))
    process.exitCode = 1
  })

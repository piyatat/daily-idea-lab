#!/usr/bin/env node
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeSession } from './analyze.js'
import { loadPolicy } from './policy.js'
import { formatCsv, formatJson, formatMarkdown } from './report.js'

type Args = {
  session?: string
  policy?: string
  json: boolean
  csv: boolean
  out?: string
  help: boolean
  version: boolean
}

function packageVersion(): string {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
    if (typeof pkg.version === 'string' && pkg.version.trim()) return pkg.version.trim()
  } catch {
    // fall through
  }
  return '0.0.0'
}

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, csv: false, help: false, version: false }
  const rest: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') {
      args.help = true
    } else if (a === '--version' || a === '-V') {
      args.version = true
    } else if (a === '--json') {
      args.json = true
    } else if (a === '--csv') {
      args.csv = true
    } else if (a === '--policy' || a === '-p') {
      args.policy = argv[++i]
    } else if (a === '--out' || a === '-o') {
      args.out = argv[++i]
    } else if (!a.startsWith('-')) {
      rest.push(a)
    } else {
      throw new Error(`Unknown flag: ${a}`)
    }
  }

  if (rest[0] === 'analyze') {
    args.session = rest[1]
  } else if (rest[0] && !rest[0].startsWith('-')) {
    args.session = rest[0]
  }

  return args
}

function printHelp(): void {
  console.log(`agentledger — autopsy coding-agent session logs

Usage:
  agentledger analyze <session.jsonl> [options]
  agentledger <session.jsonl> [options]

Options:
  -p, --policy <file>   Policy YAML (max_session_usd, require_review patterns)
  -o, --out <file>      Write report to file
      --json            JSON output
      --csv             CSV per-turn export
  -h, --help            Show help
  -V, --version         Show version

Session format:
  JSONL with one turn per line, or a JSON array. Each turn may include:
  ts, model, tools/tool_calls, content, usage { input, output, cacheRead }

Examples:
  agentledger analyze ./session.jsonl
  agentledger analyze ./session.jsonl --policy policy.yaml --json
  agentledger analyze ./session.jsonl --csv -o turns.csv
`)
}

function assertFile(path: string): string {
  const resolved = resolve(path)
  if (!existsSync(resolved)) throw new Error(`File not found: ${resolved}`)
  if (!statSync(resolved).isFile()) throw new Error(`Not a file: ${resolved}`)
  return resolved
}

async function main(): Promise<void> {
  let args: Args
  try {
    args = parseArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(2)
  }

  if (args.help) {
    printHelp()
    return
  }

  if (args.version) {
    console.log(packageVersion())
    return
  }

  if (!args.session) {
    console.error('Error: session file required\n')
    printHelp()
    process.exit(2)
  }

  const sessionPath = assertFile(args.session)
  const policy = loadPolicy(args.policy)

  const report = analyzeSession(sessionPath, policy)

  let output: string
  if (args.json) {
    output = formatJson(report)
  } else if (args.csv) {
    output = formatCsv(report)
  } else {
    output = formatMarkdown(report)
  }

  if (args.out) {
    writeFileSync(resolve(args.out), output, 'utf8')
    if (!args.json && !args.csv) {
      console.log(`Report written to ${resolve(args.out)}`)
    }
  } else {
    console.log(output)
  }

  const fail =
    report.policyViolations.length > 0 ||
    (policy.maxSessionUsd != null && report.totalCostUsd > policy.maxSessionUsd)
  if (fail) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})

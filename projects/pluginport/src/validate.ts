import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkContainment } from './rules/containment.js'
import { checkPortability, filterClients } from './rules/portability.js'
import { checkSecrets } from './rules/secrets.js'
import {
  readJsonFile,
  validateManifestSchemas,
  validateSchemaVersionMatch,
} from './rules/schema.js'
import { checkSkills, pluginHasSkills } from './rules/skills.js'
import type { CheckResult, CompatResult, Finding, McpConfig, PluginManifest } from './types.js'

export type CheckOptions = {
  strict?: boolean
}

function summarize(findings: Finding[], pluginName?: string): string {
  const high = findings.filter((f) => f.severity === 'high').length
  const medium = findings.filter((f) => f.severity === 'medium').length
  const label = pluginName ?? 'plugin'
  if (findings.length === 0) return `${label} passes Agent Plugins 1.0.0 checks.`
  const parts = [`${findings.length} finding(s)`]
  if (high) parts.push(`${high} high`)
  if (medium) parts.push(`${medium} medium`)
  return parts.join(' · ')
}

function loadPlugin(pluginDir: string): {
  plugin: PluginManifest | null
  mcp: McpConfig | null
  pluginFile: string
  mcpFile: string
  findings: Finding[]
} {
  const findings: Finding[] = []
  const pluginFile = join(pluginDir, 'plugin.json')
  const mcpFile = join(pluginDir, 'mcp.json')

  if (!existsSync(pluginFile)) {
    findings.push({
      rule: 'manifest',
      severity: 'high',
      file: pluginFile,
      message: 'Missing required plugin.json at plugin root.',
      fix: 'Add plugin.json with $schema and name fields per Agent Plugins 1.0.0.',
    })
    return { plugin: null, mcp: null, pluginFile, mcpFile, findings }
  }

  let plugin: PluginManifest | null = null
  let mcp: McpConfig | null = null

  try {
    plugin = readJsonFile<PluginManifest>(pluginFile)
  } catch (err) {
    findings.push({
      rule: 'manifest',
      severity: 'high',
      file: pluginFile,
      message: `plugin.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      fix: 'Fix JSON syntax in plugin.json.',
    })
  }

  if (existsSync(mcpFile)) {
    try {
      mcp = readJsonFile<McpConfig>(mcpFile)
    } catch (err) {
      findings.push({
        rule: 'manifest',
        severity: 'high',
        file: mcpFile,
        message: `mcp.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        fix: 'Fix JSON syntax in mcp.json.',
      })
    }
  }

  return { plugin, mcp, pluginFile, mcpFile, findings }
}

export function checkPlugin(pluginDir: string, options: CheckOptions = {}): CheckResult {
  const root = resolve(pluginDir)
  const { plugin, mcp, pluginFile, mcpFile, findings: loadFindings } = loadPlugin(root)
  const findings: Finding[] = [...loadFindings]

  if (plugin) {
    findings.push(...validateManifestSchemas(plugin, mcp, pluginFile, mcpFile))
    findings.push(...validateSchemaVersionMatch(plugin, mcp, mcpFile))
  }

  if (mcp) {
    findings.push(...checkContainment(root, mcp, mcpFile))
    findings.push(...checkSecrets(mcp, mcpFile))
  }

  findings.push(...checkSkills(root))

  const portability = checkPortability(root, mcp, pluginHasSkills(root))
  findings.push(...portability.findings)

  if (options.strict) {
    for (const f of findings) {
      if (f.severity === 'medium' || f.severity === 'low') {
        f.severity = 'high'
      }
    }
  }

  const highCount = findings.filter((f) => f.severity === 'high').length
  const pluginName = plugin?.name

  return {
    pluginDir: root,
    pluginName,
    findings,
    highCount,
    clean: findings.length === 0,
    summary: summarize(findings, pluginName),
  }
}

export function compatPlugin(
  pluginDir: string,
  clientIds: string[] = [],
): CompatResult & { pluginName?: string } {
  const root = resolve(pluginDir)
  const { plugin, mcp } = loadPlugin(root)
  const clients = filterClients(clientIds)
  const result = checkPortability(root, mcp, pluginHasSkills(root), clients)
  return { ...result, pluginName: plugin?.name }
}

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import type { ErrorObject } from 'ajv'
import type { Finding, McpConfig, PluginManifest } from '../types.js'

type AjvConstructor = new (opts?: { allErrors?: boolean; strict?: boolean }) => {
  compile: (schema: object) => (data: unknown) => boolean
  errors?: ErrorObject[] | null
}

const ajv = new (Ajv2020 as unknown as AjvConstructor)({ allErrors: true, strict: false })
;(addFormats as unknown as (a: typeof ajv) => void)(ajv)

function loadSchema(name: string): object {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'schemas')
  return JSON.parse(readFileSync(join(dir, name), 'utf8')) as object
}

const validatePlugin = ajv.compile(loadSchema('plugin.schema.json'))
const validateMcp = ajv.compile(loadSchema('mcp.schema.json'))

function schemaFindings(
  label: string,
  file: string,
  validate: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null },
  data: unknown,
): Finding[] {
  const ok = validate(data)
  if (ok) return []

  return (validate.errors ?? []).map((err: ErrorObject) => ({
    rule: 'schema',
    severity: 'high' as const,
    file,
    message: `${label}: ${err.instancePath || '/'} ${err.message ?? 'invalid'}`,
    fix: `Fix ${file} to satisfy Agent Plugins 1.0.0 ${label} schema.`,
    meta: { keyword: err.keyword, params: err.params },
  }))
}

export function validateManifestSchemas(
  plugin: PluginManifest | null,
  mcp: McpConfig | null,
  pluginFile: string,
  mcpFile: string,
): Finding[] {
  const findings: Finding[] = []
  if (plugin) {
    findings.push(...schemaFindings('plugin.json', pluginFile, validatePlugin, plugin))
  }
  if (mcp) {
    findings.push(...schemaFindings('mcp.json', mcpFile, validateMcp, mcp))
  }
  return findings
}

export function validateSchemaVersionMatch(
  plugin: PluginManifest | null,
  mcp: McpConfig | null,
  mcpFile: string,
): Finding[] {
  if (!plugin || !mcp) return []
  const pluginVer = plugin.$schema.match(/schemas\/([\d.]+)\//)?.[1]
  const mcpVer = mcp.$schema.match(/schemas\/([\d.]+)\//)?.[1]
  if (pluginVer && mcpVer && pluginVer !== mcpVer) {
    return [
      {
        rule: 'schema-version',
        severity: 'high',
        file: mcpFile,
        message: `mcp.json targets Agent Plugins ${mcpVer} but plugin.json targets ${pluginVer}.`,
        fix: 'Align $schema versions in plugin.json and mcp.json.',
      },
    ]
  }
  return []
}

export function readJsonFile<T>(path: string): T {
  const raw = readFileSync(path, 'utf8')
  return JSON.parse(raw) as T
}

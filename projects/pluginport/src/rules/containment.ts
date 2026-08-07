import { existsSync, lstatSync, realpathSync } from 'node:fs'
import { join, normalize, resolve } from 'node:path'
import type { Finding, McpConfig } from '../types.js'

const ESCAPE_PATTERNS = [/\.\./, /^\/(?!\/)/, /^[A-Za-z]:\\/, /^~[/\\]/]

function isInsideRoot(candidate: string, root: string): boolean {
  const absRoot = resolve(root)
  const absCandidate = resolve(root, candidate)
  const rel = normalize(absCandidate).slice(absRoot.length)
  return !rel.startsWith('..') && !normalize(absCandidate).includes('/../')
}

function checkPathString(
  value: string,
  context: string,
  file: string,
  pluginRoot: string,
): Finding[] {
  const findings: Finding[] = []
  for (const pat of ESCAPE_PATTERNS) {
    if (pat.test(value)) {
      findings.push({
        rule: 'containment',
        severity: 'high',
        file,
        message: `${context} references path outside plugin root: "${value}"`,
        fix: 'Use plugin-relative paths, ${PLUGIN_ROOT}, or ${PLUGIN_DATA} only.',
      })
    }
  }

  if (value.startsWith('./') || (!value.includes('${') && !value.startsWith('/'))) {
    const target = join(pluginRoot, value.replace(/^\.\//, ''))
    if (!isInsideRoot(target, pluginRoot)) {
      findings.push({
        rule: 'containment',
        severity: 'high',
        file,
        message: `${context} resolves outside plugin directory: "${value}"`,
        fix: 'Keep all filesystem references inside the plugin package.',
      })
    }
  }

  return findings
}

export function checkContainment(
  pluginRoot: string,
  mcp: McpConfig | null,
  mcpFile: string,
): Finding[] {
  if (!mcp) return []
  const findings: Finding[] = []

  for (const [name, server] of Object.entries(mcp.mcpServers)) {
    const ctx = `mcpServers.${name}`

    if (server.type === 'stdio') {
      if (server.command) {
        findings.push(...checkPathString(server.command, `${ctx}.command`, mcpFile, pluginRoot))
        if (/[;&|`$]/.test(server.command)) {
          findings.push({
            rule: 'containment',
            severity: 'medium',
            file: mcpFile,
            message: `${ctx}.command contains shell metacharacters: "${server.command}"`,
            fix: 'Use a plain executable path without shell interpolation.',
          })
        }
      }

      if (server.cwd) {
        findings.push(...checkPathString(server.cwd, `${ctx}.cwd`, mcpFile, pluginRoot))
      }

      if (server.args) {
        for (let i = 0; i < server.args.length; i++) {
          findings.push(
            ...checkPathString(server.args[i]!, `${ctx}.args[${i}]`, mcpFile, pluginRoot),
          )
        }
      }

      if (server.env) {
        for (const [key, val] of Object.entries(server.env)) {
          if (key === 'PLUGIN_ROOT' || key === 'PLUGIN_DATA') {
            findings.push({
              rule: 'containment',
              severity: 'high',
              file: mcpFile,
              message: `${ctx}.env must not set reserved key "${key}" (client-managed).`,
              fix: 'Remove PLUGIN_ROOT/PLUGIN_DATA from env; clients inject these.',
            })
          }
          findings.push(...checkPathString(val, `${ctx}.env.${key}`, mcpFile, pluginRoot))
        }
      }

      if (server.command && !server.command.includes('${')) {
        const cmdPath = server.command.startsWith('./')
          ? join(pluginRoot, server.command.slice(2))
          : join(pluginRoot, server.command)
        if (cmdPath.startsWith(pluginRoot) && !existsSync(cmdPath)) {
          findings.push({
            rule: 'containment',
            severity: 'medium',
            file: mcpFile,
            message: `${ctx}.command binary not found: ${server.command}`,
            fix: 'Ship the stdio executable or document a PATH-resolved binary.',
          })
        }
      }
    }
  }

  const skillsDir = join(pluginRoot, 'skills')
  if (existsSync(skillsDir)) {
    try {
      const realSkills = realpathSync(skillsDir)
      const realRoot = realpathSync(pluginRoot)
      if (!realSkills.startsWith(realRoot)) {
        findings.push({
          rule: 'containment',
          severity: 'high',
          file: skillsDir,
          message: 'skills/ directory escapes plugin root via symlink.',
          fix: 'Replace symlink hops with in-package skill directories.',
        })
      }
    } catch {
      /* ignore */
    }

    try {
      const stat = lstatSync(skillsDir)
      if (stat.isSymbolicLink()) {
        findings.push({
          rule: 'containment',
          severity: 'medium',
          file: skillsDir,
          message: 'skills/ is a symlink — may break portability across clients.',
          fix: 'Use a real skills/ directory inside the plugin package.',
        })
      }
    } catch {
      /* ignore */
    }
  }

  return findings
}

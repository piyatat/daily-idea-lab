import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Finding, SkillFrontmatter } from '../types.js'

const VAGUE_PATTERNS = [
  /^helps?\s+(with|you)/i,
  /^use\s+when/i,
  /^general\s+purpose/i,
  /^misc(ellaneous)?/i,
  /^various\s+/i,
  /^stuff\s+related/i,
  /^for\s+.*\s+tasks?$/i,
]

function parseFrontmatter(raw: string): { data: SkillFrontmatter; body: string } | null {
  if (!raw.startsWith('---\n')) return null
  const end = raw.indexOf('\n---\n', 4)
  if (end === -1) return null
  const fmBlock = raw.slice(4, end)
  const body = raw.slice(end + 5)
  const data: SkillFrontmatter = {}

  for (const line of fmBlock.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!m) continue
    const key = m[1]!
    let val = m[2]!.trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    data[key] = val
  }

  return { data, body }
}

export function checkSkills(pluginRoot: string): Finding[] {
  const skillsDir = join(pluginRoot, 'skills')
  if (!existsSync(skillsDir)) return []

  const findings: Finding[] = []
  const entries = readdirSync(skillsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      findings.push({
        rule: 'skills',
        severity: 'low',
        file: join(skillsDir, entry.name),
        message: `Unexpected file at skills/${entry.name} — skills must live in subdirectories.`,
        fix: 'Move skill content into skills/<name>/SKILL.md.',
      })
      continue
    }

    const skillFile = join(skillsDir, entry.name, 'SKILL.md')
    if (!existsSync(skillFile)) {
      findings.push({
        rule: 'skills',
        severity: 'high',
        file: skillFile,
        message: `Missing SKILL.md in skills/${entry.name}/`,
        fix: 'Add a SKILL.md with required frontmatter (name, description).',
      })
      continue
    }

    const raw = readFileSync(skillFile, 'utf8')
    const parsed = parseFrontmatter(raw)
    if (!parsed) {
      findings.push({
        rule: 'skills',
        severity: 'high',
        file: skillFile,
        message: `skills/${entry.name}/SKILL.md missing YAML frontmatter block.`,
        fix: 'Start SKILL.md with ---\\nname: ...\\ndescription: ...\\n---',
      })
      continue
    }

    const { data, body } = parsed
    if (!data.name) {
      findings.push({
        rule: 'skills',
        severity: 'high',
        file: skillFile,
        message: `skills/${entry.name}/SKILL.md frontmatter missing "name".`,
        fix: 'Add name: matching the skill directory (kebab-case).',
      })
    } else if (data.name !== entry.name) {
      findings.push({
        rule: 'skills',
        severity: 'medium',
        file: skillFile,
        message: `Skill directory "${entry.name}" does not match frontmatter name "${data.name}".`,
        fix: 'Rename the directory or update frontmatter name to match.',
      })
    }

    if (!data.description) {
      findings.push({
        rule: 'skills',
        severity: 'high',
        file: skillFile,
        message: `skills/${entry.name}/SKILL.md frontmatter missing "description".`,
        fix: 'Add a concrete description of when to use this skill.',
      })
    } else {
      const desc = String(data.description)
      if (desc.length < 40) {
        findings.push({
          rule: 'skills',
          severity: 'medium',
          file: skillFile,
          message: `skills/${entry.name} description is too short (${desc.length} chars).`,
          fix: 'Write a specific description (≥40 chars) so clients can route tasks correctly.',
        })
      }
      for (const pat of VAGUE_PATTERNS) {
        if (pat.test(desc)) {
          findings.push({
            rule: 'skills',
            severity: 'medium',
            file: skillFile,
            message: `skills/${entry.name} description looks vague: "${desc.slice(0, 60)}${desc.length > 60 ? '…' : ''}"`,
            fix: 'Replace boilerplate with concrete triggers, inputs, and outcomes.',
          })
          break
        }
      }
    }

    if (body.trim().length < 100) {
      findings.push({
        rule: 'skills',
        severity: 'low',
        file: skillFile,
        message: `skills/${entry.name}/SKILL.md body is very short (${body.trim().length} chars).`,
        fix: 'Expand instructions so agents know how to apply the skill.',
      })
    }
  }

  if (entries.filter((e) => e.isDirectory()).length === 0) {
    findings.push({
      rule: 'skills',
      severity: 'info',
      file: skillsDir,
      message: 'skills/ exists but contains no skill directories.',
      fix: 'Add skills/<name>/SKILL.md or remove empty skills/.',
    })
  }

  return findings
}

export function pluginHasSkills(pluginRoot: string): boolean {
  const skillsDir = join(pluginRoot, 'skills')
  if (!existsSync(skillsDir)) return false
  return readdirSync(skillsDir, { withFileTypes: true }).some((e) => e.isDirectory())
}

export function listSkillNames(pluginRoot: string): string[] {
  const skillsDir = join(pluginRoot, 'skills')
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => basename(e.name))
}

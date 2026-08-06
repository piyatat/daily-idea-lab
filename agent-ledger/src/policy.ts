import { readFileSync } from 'node:fs'
import type { PolicyConfig } from './types.js'

export function loadPolicy(path?: string): PolicyConfig {
  if (!path) return {}
  try {
    const raw = readFileSync(path, 'utf8')
    return parsePolicyYaml(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to read policy at ${path}: ${msg}`)
  }
}

/** Minimal YAML subset — no dependency. */
export function parsePolicyYaml(raw: string): PolicyConfig {
  const config: PolicyConfig = {}
  const lines = raw.split(/\r?\n/)
  let inReview = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const maxMatch = trimmed.match(/^max_session_usd:\s*([\d.]+)/i)
    if (maxMatch) {
      config.maxSessionUsd = Number(maxMatch[1])
      continue
    }

    if (/^require_review:/i.test(trimmed)) {
      inReview = true
      const inline = trimmed.match(/^\s*require_review:\s*\[(.*)\]/i)
      if (inline) {
        config.requireReview = splitYamlList(inline[1])
        inReview = false
      } else {
        config.requireReview = []
      }
      continue
    }

    if (inReview && trimmed.startsWith('- ')) {
      config.requireReview ??= []
      config.requireReview.push(trimmed.slice(2).replace(/^['"]|['"]$/g, ''))
      continue
    }

    if (inReview && !trimmed.startsWith('-')) {
      inReview = false
    }
  }

  return config
}

function splitYamlList(inner: string): string[] {
  if (!inner.trim()) return []
  return inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

export function matchPolicyPatterns(text: string, patterns: string[] | undefined): string[] {
  if (!patterns?.length) return []
  const hits: string[] = []
  const lower = text.toLowerCase()
  for (const pattern of patterns) {
    try {
      const re = new RegExp(pattern, 'i')
      if (re.test(text)) hits.push(pattern)
    } catch {
      if (lower.includes(pattern.toLowerCase())) hits.push(pattern)
    }
  }
  return hits
}

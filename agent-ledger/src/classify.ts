import type { TurnKind } from './types.js'

const EXPLORE_TOOLS = new Set([
  'read',
  'grep',
  'glob',
  'list',
  'search',
  'fetch',
  'websearch',
  'ls',
  'cat',
  'head',
  'find',
])

const IMPLEMENT_TOOLS = new Set([
  'write',
  'edit',
  'strreplace',
  'apply_patch',
  'create',
  'delete',
  'shell',
  'run_terminal_cmd',
  'execute',
])

const REVIEW_KEYWORDS = ['review', 'audit', 'lint', 'test', 'verify', 'check']

export function classifyTurn(tools: string[], contentHint = ''): TurnKind {
  const normalized = tools.map((t) => t.toLowerCase().replace(/[^a-z0-9_]/g, ''))
  const hint = contentHint.toLowerCase()

  if (normalized.some((t) => IMPLEMENT_TOOLS.has(t) || t.includes('write') || t.includes('edit'))) {
    return 'implement'
  }

  if (
    normalized.some((t) => EXPLORE_TOOLS.has(t)) &&
    !normalized.some((t) => IMPLEMENT_TOOLS.has(t))
  ) {
    return 'explore'
  }

  if (REVIEW_KEYWORDS.some((k) => hint.includes(k))) {
    return 'review'
  }

  if (hint.includes('plan') || hint.includes('design') || hint.includes('architect')) {
    return 'plan'
  }

  if (normalized.length === 0 && hint.length > 800) {
    return 'plan'
  }

  return normalized.length > 0 ? 'other' : 'plan'
}

export function toolNamesFromRecord(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const names: string[] = []
  for (const item of raw) {
    if (typeof item === 'string') {
      names.push(item)
      continue
    }
    if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>
      if (typeof obj.name === 'string') names.push(obj.name)
      else if (typeof obj.tool === 'string') names.push(obj.tool)
      else if (typeof obj.type === 'string') names.push(obj.type)
    }
  }
  return names
}

import { readFileSync } from 'node:fs'
import { classifyTurn, toolNamesFromRecord } from './classify.js'
import type { SessionTurn, TurnKind, Usage } from './types.js'

export type RawTurn = {
  ts?: string
  timestamp?: string
  time?: string
  model?: string
  role?: string
  content?: string
  tools?: unknown
  tool_calls?: unknown
  usage?: Partial<Usage> & {
    input_tokens?: number
    output_tokens?: number
    cache_read_tokens?: number
    cache_write_tokens?: number
    prompt_tokens?: number
    completion_tokens?: number
  }
}

const CACHE_GAP_MS = 5 * 60 * 1000

export function parseSessionFile(path: string): RawTurn[] {
  const text = readFileSync(path, 'utf8').trim()
  if (!text) return []

  if (text.startsWith('[')) {
    const arr = JSON.parse(text) as unknown
    if (!Array.isArray(arr)) throw new Error('Expected JSON array at root')
    return arr.map(normalizeRawTurn)
  }

  const turns: RawTurn[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    try {
      const obj = JSON.parse(trimmed) as unknown
      if (Array.isArray(obj)) {
        turns.push(...obj.map(normalizeRawTurn))
      } else if (obj && typeof obj === 'object') {
        turns.push(normalizeRawTurn(obj as RawTurn))
      }
    } catch {
      // skip malformed lines
    }
  }
  return turns
}

function normalizeRawTurn(raw: RawTurn): RawTurn {
  const usage = raw.usage ?? {}
  return {
    ...raw,
    model: raw.model ?? 'claude-sonnet-5',
    tools: raw.tools ?? raw.tool_calls,
    usage: {
      input: num(usage.input ?? usage.input_tokens ?? usage.prompt_tokens),
      output: num(usage.output ?? usage.output_tokens ?? usage.completion_tokens),
      cacheRead: num(usage.cacheRead ?? usage.cache_read_tokens) || undefined,
      cacheWrite: num(usage.cacheWrite ?? usage.cache_write_tokens) || undefined,
    },
    content: typeof raw.content === 'string' ? raw.content : '',
  }
}

function num(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

export function rawToSessionTurns(rawTurns: RawTurn[]): Array<{
  ts?: Date
  model: string
  kind: TurnKind
  tools: string[]
  usage: Usage
  content: string
}> {
  return rawTurns
    .filter((t) => (t.usage?.input ?? 0) + (t.usage?.output ?? 0) > 0 || (t.tools && Array.isArray(t.tools)))
    .map((t) => {
      const tools = toolNamesFromRecord(t.tools ?? t.tool_calls)
      const content = t.content ?? ''
      return {
        ts: parseTs(t),
        model: t.model ?? 'claude-sonnet-5',
        kind: classifyTurn(tools, content),
        tools,
        usage: {
          input: t.usage?.input ?? 0,
          output: t.usage?.output ?? 0,
          cacheRead: t.usage?.cacheRead,
          cacheWrite: t.usage?.cacheWrite,
        },
        content,
      }
    })
}

function parseTs(t: RawTurn): Date | undefined {
  const s = t.ts ?? t.timestamp ?? t.time
  if (!s) return undefined
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export function detectCacheGaps(dates: (Date | undefined)[]): boolean[] {
  const gaps: boolean[] = []
  let last: Date | undefined
  for (const d of dates) {
    if (!d) {
      gaps.push(false)
      continue
    }
    if (last && d.getTime() - last.getTime() > CACHE_GAP_MS) {
      gaps.push(true)
    } else {
      gaps.push(false)
    }
    last = d
  }
  return gaps
}

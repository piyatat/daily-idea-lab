import type { ModelPricing, PricingTable, TurnKind, Usage } from './types.js'

/** USD per 1M tokens — August 2026 indicative list prices for routing estimates. */
export const PRICING: PricingTable = {
  'claude-opus-5': {
    inputPer1M: 15,
    outputPer1M: 75,
    cacheReadPer1M: 1.5,
    cacheWritePer1M: 18.75,
    tier: 'frontier',
  },
  'claude-sonnet-5': {
    inputPer1M: 3,
    outputPer1M: 15,
    cacheReadPer1M: 0.3,
    cacheWritePer1M: 3.75,
    tier: 'standard',
  },
  'claude-haiku-4.5': {
    inputPer1M: 0.8,
    outputPer1M: 4,
    cacheReadPer1M: 0.08,
    cacheWritePer1M: 1,
    tier: 'economy',
  },
  'gpt-5.6': {
    inputPer1M: 2.5,
    outputPer1M: 10,
    cacheReadPer1M: 0.25,
    tier: 'standard',
  },
  'gpt-5.6-mini': {
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    cacheReadPer1M: 0.015,
    tier: 'economy',
  },
}

const ALIASES: Record<string, string> = {
  opus: 'claude-opus-5',
  'claude-opus': 'claude-opus-5',
  sonnet: 'claude-sonnet-5',
  'claude-sonnet': 'claude-sonnet-5',
  haiku: 'claude-haiku-4.5',
  'claude-haiku': 'claude-haiku-4.5',
  'gpt-5': 'gpt-5.6',
  mini: 'gpt-5.6-mini',
}

export function normalizeModel(name: string): string {
  const lower = name.toLowerCase().trim()
  if (PRICING[lower]) return lower
  for (const [key, canonical] of Object.entries(ALIASES)) {
    if (lower.includes(key)) return canonical
  }
  return lower
}

export function getPricing(model: string): ModelPricing {
  const key = normalizeModel(model)
  return (
    PRICING[key] ?? {
      inputPer1M: 3,
      outputPer1M: 15,
      cacheReadPer1M: 0.3,
      tier: 'standard' as const,
    }
  )
}

export function recommendedModel(kind: TurnKind): string {
  switch (kind) {
    case 'explore':
      return 'claude-haiku-4.5'
    case 'plan':
    case 'review':
      return 'claude-opus-5'
    case 'implement':
      return 'claude-sonnet-5'
    default:
      return 'claude-sonnet-5'
  }
}

export function estimateCost(model: string, usage: Usage): number {
  const p = getPricing(model)
  const billableInput = Math.max(0, usage.input - (usage.cacheRead ?? 0))
  const inputCost = (billableInput / 1_000_000) * p.inputPer1M
  const cacheReadCost = ((usage.cacheRead ?? 0) / 1_000_000) * (p.cacheReadPer1M ?? p.inputPer1M * 0.1)
  const cacheWriteCost = ((usage.cacheWrite ?? 0) / 1_000_000) * (p.cacheWritePer1M ?? p.inputPer1M * 1.25)
  const outputCost = (usage.output / 1_000_000) * p.outputPer1M
  return inputCost + cacheReadCost + cacheWriteCost + outputCost
}

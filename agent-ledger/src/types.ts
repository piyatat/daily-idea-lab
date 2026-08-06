export type TurnKind = 'explore' | 'plan' | 'implement' | 'review' | 'other'

export type Usage = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

export type SessionTurn = {
  index: number
  ts?: Date
  model: string
  kind: TurnKind
  tools: string[]
  usage: Usage
  costUsd: number
  routedCostUsd: number
  routedModel: string
  cacheGap: boolean
  policyFlags: string[]
}

export type SessionReport = {
  source: string
  turnCount: number
  totalCostUsd: number
  routedCostUsd: number
  savingsUsd: number
  savingsPct: number
  kindMix: Record<TurnKind, number>
  cacheGapCount: number
  policyViolations: string[]
  turns: SessionTurn[]
  topExpensiveExplore: SessionTurn[]
}

export type PolicyConfig = {
  maxSessionUsd?: number
  requireReview?: string[]
}

export type ModelPricing = {
  inputPer1M: number
  outputPer1M: number
  cacheReadPer1M?: number
  cacheWritePer1M?: number
  tier: 'frontier' | 'standard' | 'economy'
}

export type PricingTable = Record<string, ModelPricing>

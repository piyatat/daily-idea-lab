import { matchPolicyPatterns } from './policy.js'
import { detectCacheGaps, parseSessionFile, rawToSessionTurns } from './parse.js'
import { estimateCost, recommendedModel } from './pricing.js'
import type { PolicyConfig, SessionReport, SessionTurn, TurnKind } from './types.js'

export function analyzeSession(source: string, policy: PolicyConfig = {}): SessionReport {
  const raw = parseSessionFile(source)
  const parsed = rawToSessionTurns(raw)
  const cacheGaps = detectCacheGaps(parsed.map((t) => t.ts))

  const turns: SessionTurn[] = parsed.map((t, index) => {
    const routedModel = recommendedModel(t.kind)
    const costUsd = estimateCost(t.model, t.usage)
    const routedCostUsd = estimateCost(routedModel, t.usage)
    const actionText = [...t.tools, t.content].join(' ')
    const policyFlags = matchPolicyPatterns(actionText, policy.requireReview)

    return {
      index,
      ts: t.ts,
      model: t.model,
      kind: t.kind,
      tools: t.tools,
      usage: t.usage,
      costUsd,
      routedCostUsd,
      routedModel,
      cacheGap: cacheGaps[index] ?? false,
      policyFlags,
    }
  })

  const totalCostUsd = sum(turns.map((t) => t.costUsd))
  const routedCostUsd = sum(turns.map((t) => t.routedCostUsd))
  const savingsUsd = Math.max(0, totalCostUsd - routedCostUsd)
  const savingsPct = totalCostUsd > 0 ? (savingsUsd / totalCostUsd) * 100 : 0

  const kindMix = emptyKindMix()
  for (const t of turns) {
    kindMix[t.kind] += 1
  }

  const policyViolations: string[] = []
  if (policy.maxSessionUsd != null && totalCostUsd > policy.maxSessionUsd) {
    policyViolations.push(
      `Session cost $${totalCostUsd.toFixed(4)} exceeds max_session_usd $${policy.maxSessionUsd}`,
    )
  }

  const flagged = turns.filter((t) => t.policyFlags.length > 0)
  for (const t of flagged) {
    policyViolations.push(`Turn ${t.index + 1}: would require review (${t.policyFlags.join(', ')})`)
  }

  const topExpensiveExplore = turns
    .filter((t) => t.kind === 'explore')
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 5)

  return {
    source,
    turnCount: turns.length,
    totalCostUsd,
    routedCostUsd,
    savingsUsd,
    savingsPct,
    kindMix,
    cacheGapCount: turns.filter((t) => t.cacheGap).length,
    policyViolations,
    turns,
    topExpensiveExplore,
  }
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0)
}

function emptyKindMix(): Record<TurnKind, number> {
  return { explore: 0, plan: 0, implement: 0, review: 0, other: 0 }
}

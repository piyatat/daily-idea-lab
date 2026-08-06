import type { SessionReport, TurnKind } from './types.js'

const KIND_LABEL: Record<TurnKind, string> = {
  explore: 'Explore',
  plan: 'Plan',
  implement: 'Implement',
  review: 'Review',
  other: 'Other',
}

export function formatMarkdown(report: SessionReport): string {
  const lines: string[] = []
  lines.push('# Agent session autopsy')
  lines.push('')
  lines.push(`**Source:** \`${report.source}\``)
  lines.push(`**Turns:** ${report.turnCount}`)
  lines.push('')
  lines.push('## Cost summary')
  lines.push('')
  lines.push('| Metric | Value |')
  lines.push('| --- | --- |')
  lines.push(`| Actual cost | $${report.totalCostUsd.toFixed(4)} |`)
  lines.push(`| Routed (recommended tiers) | $${report.routedCostUsd.toFixed(4)} |`)
  lines.push(`| Potential savings | $${report.savingsUsd.toFixed(4)} (${report.savingsPct.toFixed(1)}%) |`)
  lines.push(`| Cache-cold gaps | ${report.cacheGapCount} |`)
  lines.push('')

  lines.push('## Turn mix')
  lines.push('')
  for (const [kind, count] of Object.entries(report.kindMix)) {
    if (count === 0) continue
    const pct = report.turnCount > 0 ? ((count / report.turnCount) * 100).toFixed(0) : '0'
    lines.push(`- **${KIND_LABEL[kind as TurnKind]}:** ${count} (${pct}%)`)
  }
  lines.push('')

  if (report.topExpensiveExplore.length > 0) {
    lines.push('## Top expensive explore turns')
    lines.push('')
    lines.push('| Turn | Model | Cost | Tools |')
    lines.push('| --- | --- | --- | --- |')
    for (const t of report.topExpensiveExplore) {
      lines.push(
        `| ${t.index + 1} | ${t.model} | $${t.costUsd.toFixed(4)} | ${t.tools.join(', ') || '—'} |`,
      )
    }
    lines.push('')
    lines.push(
      '> Explore turns on frontier models are the fastest win — route reads/greps to economy tier.',
    )
    lines.push('')
  }

  if (report.policyViolations.length > 0) {
    lines.push('## Policy digest')
    lines.push('')
    for (const v of report.policyViolations) {
      lines.push(`- ⚠ ${v}`)
    }
    lines.push('')
  }

  if (report.cacheGapCount > 0) {
    lines.push('## Cache gaps')
    lines.push('')
    lines.push(
      'Turns after >5 min idle likely re-sent full context (cache miss). Batch work or keep sessions warm.',
    )
    lines.push('')
    for (const t of report.turns.filter((x) => x.cacheGap)) {
      lines.push(`- Turn ${t.index + 1}${t.ts ? ` (${t.ts.toISOString()})` : ''}`)
    }
    lines.push('')
  }

  lines.push('## Per-turn breakdown')
  lines.push('')
  lines.push('| # | Kind | Model → routed | Cost | Savings | Tools |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const t of report.turns) {
    const save = t.costUsd - t.routedCostUsd
    lines.push(
      `| ${t.index + 1} | ${t.kind} | ${t.model} → ${t.routedModel} | $${t.costUsd.toFixed(4)} | $${save.toFixed(4)} | ${t.tools.join(', ') || '—'} |`,
    )
  }
  lines.push('')

  return lines.join('\n')
}

export function formatJson(report: SessionReport): string {
  return JSON.stringify(report, null, 2)
}

export function formatCsv(report: SessionReport): string {
  const header =
    'turn,kind,model,routed_model,input,output,cache_read,cost_usd,routed_cost_usd,savings_usd,cache_gap,tools'
  const rows = report.turns.map((t) => {
    const save = t.costUsd - t.routedCostUsd
    const tools = t.tools.join(';').replace(/"/g, '""')
    return [
      t.index + 1,
      t.kind,
      t.model,
      t.routedModel,
      t.usage.input,
      t.usage.output,
      t.usage.cacheRead ?? 0,
      t.costUsd.toFixed(6),
      t.routedCostUsd.toFixed(6),
      save.toFixed(6),
      t.cacheGap ? 1 : 0,
      `"${tools}"`,
    ].join(',')
  })
  return [header, ...rows].join('\n')
}

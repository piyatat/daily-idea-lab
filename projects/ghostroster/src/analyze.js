/**
 * @typedef {Object} SessionEvent
 * @property {string} lineType
 * @property {'spawn'|'complete'|'abort'|'status'|'tool'|'other'} kind
 * @property {number|undefined} ts
 * @property {string|undefined} agentId
 * @property {string|undefined} parentId
 * @property {string|undefined} childId
 * @property {string|undefined} status
 * @property {string|undefined} tool
 * @property {string|undefined} input
 * @property {string|undefined} task
 * @property {Record<string, unknown>} raw
 */

/**
 * @typedef {Object} Finding
 * @property {string} id
 * @property {'critical'|'high'|'medium'|'low'} severity
 * @property {string} title
 * @property {string} detail
 * @property {string[]} agents
 */

/**
 * @typedef {Object} AnalyzeOptions
 * @property {number} staleHours
 * @property {number} maxDepth
 * @property {number} pollThreshold
 * @property {string|undefined} rootAgentId
 */

/**
 * @typedef {Object} AnalyzeReport
 * @property {string} version
 * @property {AnalyzeSummary} summary
 * @property {Finding[]} findings
 * @property {AgentStats[]} agents
 */

/**
 * @typedef {Object} AnalyzeSummary
 * @property {number} events
 * @property {number} agents
 * @property {number} openSpawns
 * @property {number} maxDepth
 * @property {number} findings
 * @property {Record<string, number>} bySeverity
 */

/**
 * @typedef {Object} AgentStats
 * @property {string} id
 * @property {string|undefined} parentId
 * @property {number} depth
 * @property {string} lifecycle
 * @property {number|undefined} lastActivityMs
 * @property {number|undefined} completedMs
 * @property {boolean} spawnOpen
 * @property {number} toolCalls
 */

const ROOT = "__root__";

/**
 * @param {SessionEvent[]} events
 * @param {AnalyzeOptions} options
 * @returns {AnalyzeReport}
 */
export function analyzeSession(events, options) {
  const agents = new Map();
  const spawnEdges = [];
  const toolHistory = [];
  let sessionEndMs = 0;

  ensureAgent(agents, ROOT, { depth: 0, parentId: undefined });

  for (const event of events) {
    if (event.ts && event.ts > sessionEndMs) sessionEndMs = event.ts;
    ingestEvent(agents, spawnEdges, toolHistory, event, options.rootAgentId);
  }

  if (sessionEndMs === 0) {
    sessionEndMs = Date.now();
  }

  const staleMs = options.staleHours * 60 * 60 * 1000;
  const findings = [];

  for (const edge of spawnEdges) {
    if (!edge.closed && edge.completedMs != null) {
      findings.push({
        id: "ghost-open",
        severity: "critical",
        title: "Completed subagent still marked open",
        detail: `Spawn edge ${edge.parentId} → ${edge.childId} has task_complete but remains open (quota-risk pattern from Codex #37299).`,
        agents: [edge.childId],
      });
    }
  }

  for (const [id, agent] of agents) {
    if (id === ROOT) continue;

    const idleMs = sessionEndMs - (agent.lastActivityMs ?? agent.spawnedMs ?? sessionEndMs);
    const isRunning =
      agent.lifecycle === "running" ||
      agent.lifecycle === "open" ||
      (agent.spawnOpen && agent.lifecycle !== "complete" && agent.lifecycle !== "aborted");

    if (isRunning && idleMs >= staleMs) {
      findings.push({
        id: "stale-running",
        severity: idleMs >= staleMs * 3 ? "critical" : "high",
        title: "Stale running subagent",
        detail: `${id} shows running/open with no activity for ${formatHours(idleMs)}.`,
        agents: [id],
      });
    }

    if (agent.depth > options.maxDepth) {
      findings.push({
        id: "deep-tree",
        severity: agent.depth > options.maxDepth + 5 ? "critical" : "high",
        title: "Subagent nesting exceeds cap",
        detail: `${id} sits at depth ${agent.depth} (cap ${options.maxDepth}); deep trees correlate with quota blowouts (#35463).`,
        agents: [id],
      });
    }

    if (agent.completedMs != null && agent.postCompleteTools > 0) {
      findings.push({
        id: "post-done-churn",
        severity: "medium",
        title: "Activity after completion marker",
        detail: `${id} logged ${agent.postCompleteTools} tool call(s) after task_complete.`,
        agents: [id],
      });
    }

    if (
      agent.spawnOpen &&
      agent.lifecycle !== "complete" &&
      agent.lifecycle !== "aborted" &&
      agent.toolCalls === 0 &&
      idleMs >= 3600000
    ) {
      findings.push({
        id: "orphan-spawn",
        severity: "high",
        title: "Orphaned spawn with no work",
        detail: `${id} was spawned but never ran tools and has no terminal state.`,
        agents: [id],
      });
    }
  }

  const pollFindings = detectPollLoops(toolHistory, options.pollThreshold);
  findings.push(...pollFindings);

  const agentList = [...agents.values()]
    .filter((a) => a.id !== ROOT)
    .sort((a, b) => a.id.localeCompare(b.id));

  const openSpawns = spawnEdges.filter((e) => !e.closed).length;
  const maxDepth = agentList.reduce((max, a) => Math.max(max, a.depth), 0);
  const bySeverity = countBySeverity(findings);

  return {
    version: "0.1.0",
    summary: {
      events: events.length,
      agents: agentList.length,
      openSpawns,
      maxDepth,
      findings: findings.length,
      bySeverity,
    },
    findings: dedupeFindings(findings),
    agents: agentList,
  };
}

/**
 * @param {Map<string, AgentRecord>} agents
 * @param {SpawnEdge[]} spawnEdges
 * @param {ToolRecord[]} toolHistory
 * @param {SessionEvent} event
 * @param {string|undefined} rootAgentId
 */
function ingestEvent(agents, spawnEdges, toolHistory, event, rootAgentId) {
  const ts = event.ts ?? Date.now();

  if (event.kind === "spawn") {
    const parentId = event.parentId ?? rootAgentId ?? ROOT;
    const childId = event.childId ?? event.agentId;
    if (!childId) return;

    const parent = ensureAgent(agents, parentId, { depth: parentId === ROOT ? 0 : undefined });
    const depth = (parent?.depth ?? 0) + 1;
    const child = ensureAgent(agents, childId, {
      depth,
      parentId: parentId === ROOT ? undefined : parentId,
      spawnedMs: ts,
      lifecycle: "running",
      spawnOpen: true,
      task: event.task,
    });
    child.lastActivityMs = ts;
    spawnEdges.push({
      parentId,
      childId,
      spawnedMs: ts,
      closed: false,
      completedMs: undefined,
    });
    return;
  }

  const agentId = event.agentId ?? event.childId;
  if (!agentId) {
    if (event.kind === "tool") {
      const root = ensureAgent(agents, rootAgentId ?? ROOT, { depth: 0 });
      root.lastActivityMs = ts;
      root.toolCalls += 1;
      recordTool(toolHistory, rootAgentId ?? ROOT, event, ts);
    }
    return;
  }

  const agent = ensureAgent(agents, agentId, {});

  if (event.kind === "complete") {
    agent.lifecycle = "complete";
    agent.completedMs = ts;
    agent.lastActivityMs = ts;
    closeSpawn(spawnEdges, agentId, ts);
    return;
  }

  if (event.kind === "abort") {
    agent.lifecycle = "aborted";
    agent.lastActivityMs = ts;
    closeSpawn(spawnEdges, agentId, ts);
    return;
  }

  if (event.kind === "status" && event.status) {
    agent.lifecycle = event.status;
    agent.lastActivityMs = ts;
    if (["complete", "completed", "done"].includes(event.status)) {
      agent.completedMs = ts;
      closeSpawn(spawnEdges, agentId, ts);
    }
    if (["running", "working", "open", "pending", "pending_init"].includes(event.status)) {
      agent.spawnOpen = true;
      reopenSpawn(spawnEdges, agentId);
    }
    return;
  }

  if (event.kind === "tool") {
    if (agent.completedMs != null && ts >= agent.completedMs) {
      agent.postCompleteTools += 1;
    }
    agent.toolCalls += 1;
    agent.lastActivityMs = ts;
    recordTool(toolHistory, agentId, event, ts);
  }
}

/** @typedef {{ id: string, parentId?: string, depth: number, lifecycle: string, spawnedMs?: number, lastActivityMs?: number, completedMs?: number, spawnOpen: boolean, toolCalls: number, postCompleteTools: number, task?: string }} AgentRecord */

/** @typedef {{ parentId: string, childId: string, spawnedMs: number, closed: boolean, completedMs?: number }} SpawnEdge */

/** @typedef {{ agentId: string, tool: string, input: string, ts: number }} ToolRecord */

/**
 * @param {Map<string, AgentRecord>} agents
 * @param {string} id
 * @param {Partial<AgentRecord>} seed
 */
function ensureAgent(agents, id, seed) {
  let agent = agents.get(id);
  if (!agent) {
    agent = {
      id,
      parentId: seed.parentId,
      depth: seed.depth ?? (id === ROOT ? 0 : 1),
      lifecycle: seed.lifecycle ?? "unknown",
      spawnedMs: seed.spawnedMs,
      lastActivityMs: seed.lastActivityMs,
      completedMs: seed.completedMs,
      spawnOpen: seed.spawnOpen ?? false,
      toolCalls: 0,
      postCompleteTools: 0,
      task: seed.task,
    };
    agents.set(id, agent);
    return agent;
  }

  if (seed.parentId !== undefined) agent.parentId = seed.parentId;
  if (seed.depth !== undefined) agent.depth = seed.depth;
  if (seed.lifecycle !== undefined) agent.lifecycle = seed.lifecycle;
  if (seed.spawnedMs !== undefined) agent.spawnedMs = seed.spawnedMs;
  if (seed.lastActivityMs !== undefined) agent.lastActivityMs = seed.lastActivityMs;
  if (seed.completedMs !== undefined) agent.completedMs = seed.completedMs;
  if (seed.spawnOpen !== undefined) agent.spawnOpen = seed.spawnOpen;
  if (seed.task !== undefined) agent.task = seed.task;
  return agent;
}

/** @param {SpawnEdge[]} spawnEdges @param {string} childId */
function reopenSpawn(spawnEdges, childId) {
  for (const edge of spawnEdges) {
    if (edge.childId === childId && edge.completedMs != null) {
      edge.closed = false;
    }
  }
}

/** @param {SpawnEdge[]} spawnEdges @param {string} childId @param {number} ts */
function closeSpawn(spawnEdges, childId, ts) {
  for (const edge of spawnEdges) {
    if (edge.childId === childId && !edge.closed) {
      edge.closed = true;
      edge.completedMs = edge.completedMs ?? ts;
    }
  }
}

/** @param {ToolRecord[]} toolHistory @param {string} agentId @param {SessionEvent} event @param {number} ts */
function recordTool(toolHistory, agentId, event, ts) {
  const tool = event.tool ?? "unknown";
  const input = event.input ?? "";
  toolHistory.push({ agentId, tool, input, ts });
}

/** @param {ToolRecord[]} toolHistory @param {number} pollThreshold */
function detectPollLoops(toolHistory, pollThreshold) {
  /** @type {Finding[]} */
  const findings = [];
  const windowMs = 30 * 60 * 1000;
  const buckets = new Map();

  for (const record of toolHistory) {
    const key = `${record.agentId}\0${record.tool}\0${record.input}`;
    if (!buckets.has(key)) buckets.set(key, []);
    const list = buckets.get(key);
    list.push(record.ts);
    const recent = list.filter((t) => record.ts - t <= windowMs);
    buckets.set(key, recent);
    if (recent.length >= pollThreshold) {
      findings.push({
        id: "poll-loop",
        severity: recent.length >= pollThreshold * 2 ? "critical" : "high",
        title: "Repeated wait/status polling loop",
        detail: `${record.agentId} ran ${record.tool} with identical input ${recent.length} times in 30m (matches Codex idle orchestration pattern #37299).`,
        agents: [record.agentId],
      });
    }
  }

  return dedupeFindings(findings);
}

/** @param {Finding[]} findings */
function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.id}:${f.agents.join(",")}:${f.detail.slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** @param {Finding[]} findings */
function countBySeverity(findings) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

/** @param {number} ms */
function formatHours(ms) {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 1) return `${Math.round(ms / 60000)}m`;
  return `${hours.toFixed(1)}h`;
}

/** @param {AnalyzeReport} report */
export function shouldFail(report) {
  return report.findings.some((f) => f.severity === "critical" || f.severity === "high");
}

/** @param {AnalyzeReport} report */
export function formatReport(report) {
  const lines = [];
  lines.push(`ghostroster ${report.version} — ${report.summary.findings} finding(s)`);
  lines.push(
    `agents=${report.summary.agents} open_spawns=${report.summary.openSpawns} max_depth=${report.summary.maxDepth} events=${report.summary.events}`,
  );
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No stale subagents or quota-risk patterns detected.");
    return lines.join("\n");
  }

  for (const finding of report.findings) {
    lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`);
    lines.push(`  ${finding.detail}`);
    lines.push(`  agents: ${finding.agents.join(", ")}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

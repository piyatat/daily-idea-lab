/**
 * trapdeck — pre-approval npm/pnpm script expander with bait-pattern detection.
 * Zero dependencies. Deterministic. Fixture-testable.
 */

export const PROFILE = "trapdeck-v1";
export const VERSION = "0.1.0";

const LIFECYCLE_SCRIPTS = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepublish",
  "prepare",
  "prepack",
  "postpack",
  "prepublishOnly"
]);

const BAIT_SCRIPT_NAMES = new Set([
  "setup",
  "init",
  "bootstrap",
  "postinstall",
  "prepare",
  "install-deps",
  "dev-setup"
]);

export const BAIT_RULES = [
  {
    id: "SETUP_TRAP",
    severity: "error",
    description:
      "Benign-looking setup/init script expands into lifecycle hooks or remote fetch"
  },
  {
    id: "LIFECYCLE_HOOK",
    severity: "error",
    description: "Expanded chain invokes npm lifecycle hook scripts"
  },
  {
    id: "REMOTE_PIPE_SHELL",
    severity: "error",
    description: "curl/wget output piped to sh/bash/zsh"
  },
  {
    id: "REMOTE_FETCH",
    severity: "warning",
    description: "Remote fetch via curl, wget, or node fetch to non-localhost URL"
  },
  {
    id: "HIDDEN_NODE",
    severity: "error",
    description: "node executes a dotfile or agent hook path (.claude, .vscode, /tmp)"
  },
  {
    id: "SECRET_TOUCH",
    severity: "error",
    description: "Expanded command reads credential or env secret paths"
  },
  {
    id: "NESTED_RUN_DEPTH",
    severity: "warning",
    description: "Deep npm/pnpm run nesting suggests obfuscated intent"
  },
  {
    id: "NPX_REMOTE",
    severity: "warning",
    description: "npx -y/--yes pulls and executes remote package without lockfile pin"
  }
];

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finding(rule, severity, message, evidence) {
  const item = { rule, severity, message };
  if (evidence !== undefined) item.evidence = evidence;
  return item;
}

export function parsePackageJson(text, path = "package.json") {
  try {
    const parsed = JSON.parse(text);
    if (!isObject(parsed)) {
      return { ok: false, error: `${path}: root must be an object`, pkg: null };
    }
    return { ok: true, pkg: parsed, error: null };
  } catch (error) {
    return {
      ok: false,
      error: `${path}: ${error instanceof Error ? error.message : String(error)}`,
      pkg: null
    };
  }
}

function scriptsMap(pkg) {
  const scripts = pkg?.scripts;
  if (!isObject(scripts)) return {};
  return scripts;
}

function tokenizeCommand(cmd) {
  const tokens = [];
  let current = "";
  let quote = null;

  for (let i = 0; i < cmd.length; i += 1) {
    const ch = cmd[i];
    if (quote) {
      if (ch === quote && cmd[i - 1] !== "\\") {
        quote = null;
        tokens.push(current);
        current = "";
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (current) {
        tokens.push(current);
        current = "";
      }
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current) tokens.push(current);
  return tokens;
}

function detectRunInvocation(tokens) {
  if (tokens.length < 2) return null;
  const manager = tokens[0];
  if (!/^(npm|pnpm|yarn)$/i.test(manager)) return null;
  if (tokens[1] !== "run") return null;
  const scriptName = tokens[2];
  if (!scriptName || scriptName.startsWith("-")) return null;
  return { manager: manager.toLowerCase(), scriptName };
}

function detectNpxInvocation(tokens) {
  if (tokens.length < 1) return null;
  if (!/^npx$/i.test(tokens[0])) return null;
  const flags = new Set();
  let packageName = null;
  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "-y" || token === "--yes") {
      flags.add("yes");
      continue;
    }
    if (token.startsWith("-")) continue;
    packageName = token;
      break;
  }
  return { packageName, flags: [...flags] };
}

export function expandScriptChain({
  command,
  pkg,
  pkgPath = "package.json",
  maxDepth = 6,
  visited = new Set()
}) {
  const chain = [];
  const errors = [];

  function walk(stepCommand, depth, via) {
    if (depth > maxDepth) {
      errors.push(`Max expansion depth (${maxDepth}) exceeded at: ${stepCommand}`);
      return;
    }

    const tokens = tokenizeCommand(stepCommand);
    const run = detectRunInvocation(tokens);
    const step = {
      depth,
      via,
      command: stepCommand,
      kind: run ? "npm-run" : "shell",
      scriptName: run?.scriptName ?? null,
      manager: run?.manager ?? null
    };
    chain.push(step);

    if (!run) return;

    const visitKey = `${run.manager}:${run.scriptName}`;
    if (visited.has(visitKey)) {
      errors.push(`Cycle detected: ${visitKey}`);
      return;
    }
    visited.add(visitKey);

    const scriptBody = scriptsMap(pkg)[run.scriptName];
    if (scriptBody === undefined) {
      errors.push(`Missing script "${run.scriptName}" in ${pkgPath}`);
      return;
    }

    const nested = String(scriptBody)
      .split("&&")
      .map((part) => part.trim())
      .filter(Boolean);

    for (const part of nested) {
      walk(part, depth + 1, run.scriptName);
    }
  }

  walk(command, 0, null);

  return { chain, errors, profile: PROFILE };
}

export function detectBaits({ command, chain, pkgPath = "package.json" }) {
  const findings = [];
  const seen = new Set();
  const add = (item) => {
    const key = `${item.rule}:${JSON.stringify(item.evidence ?? item.message)}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(item);
  };

  const rootRun = chain.find((s) => s.depth === 0 && s.kind === "npm-run");
  const rootName = rootRun?.scriptName ?? null;
  const expandedText = chain.map((s) => s.command).join(" ; ");
  const lower = expandedText.toLowerCase();

  const hasLifecycle = chain.some(
    (s) => s.scriptName && LIFECYCLE_SCRIPTS.has(s.scriptName)
  );
  const hasRemotePipe =
    /\b(curl|wget)\b[^\n|]*\|\s*(sh|bash|zsh)\b/i.test(expandedText) ||
    /\b(curl|wget)\b[^\n]*\|\s*(sh|bash|zsh)\b/i.test(expandedText);
  const hasRemoteFetch = /\b(curl|wget)\b/i.test(expandedText);
  const hasHiddenNode =
    /\bnode\b[\s"']+(?:\.\/)?(?:\.claude\/|\.vscode\/|\/tmp\/)[^\s"']+/i.test(
      expandedText
    );
  const hasSecretTouch =
    /(?:cat|read|source|\.)\s*(?:~\/\.(?:ssh|aws|npmrc|config\/gh)|\.env(?:\.|$))/i.test(
      expandedText
    ) || /\.env\b/i.test(expandedText);
  const maxDepth = chain.reduce((m, s) => Math.max(m, s.depth), 0);

  if (hasRemotePipe) {
    add(
      finding(
        "REMOTE_PIPE_SHELL",
        "error",
        "Remote download piped directly into a shell",
        { command, expanded: expandedText }
      )
    );
  }

  if (hasLifecycle) {
    add(
      finding(
        "LIFECYCLE_HOOK",
        "error",
        "Expanded chain includes npm lifecycle hook scripts",
        {
          hooks: chain
            .filter((s) => s.scriptName && LIFECYCLE_SCRIPTS.has(s.scriptName))
            .map((s) => s.scriptName)
        }
      )
    );
  }

  if (hasHiddenNode) {
    add(
      finding(
        "HIDDEN_NODE",
        "error",
        "node executes a hidden dotfile or temp hook path",
        { command, expanded: expandedText }
      )
    );
  }

  if (hasSecretTouch) {
    add(
      finding(
        "SECRET_TOUCH",
        "error",
        "Expanded command touches credential or env secret paths",
        { command, expanded: expandedText }
      )
    );
  }

  if (hasRemoteFetch && !hasRemotePipe) {
    add(
      finding(
        "REMOTE_FETCH",
        "warning",
        "Expanded command performs remote fetch",
        { command, expanded: expandedText }
      )
    );
  }

  if (maxDepth >= 3) {
    add(
      finding(
        "NESTED_RUN_DEPTH",
        "warning",
        `Script nesting depth ${maxDepth} exceeds comfort threshold`,
        { maxDepth, chain: chain.map((s) => s.command) }
      )
    );
  }

  const baitName = rootName && BAIT_SCRIPT_NAMES.has(rootName);
  const setupTrap =
    baitName &&
    (hasLifecycle || hasRemotePipe || hasHiddenNode || hasSecretTouch);
  if (setupTrap) {
    add(
      finding(
        "SETUP_TRAP",
        "error",
        `Benign-looking "${rootName}" script expands into risky operations`,
        { script: rootName, command }
      )
    );
  }

  for (const step of chain) {
    const tokens = tokenizeCommand(step.command);
    const npx = detectNpxInvocation(tokens);
    if (npx && npx.flags.includes("yes")) {
      add(
        finding(
          "NPX_REMOTE",
          "warning",
          "npx --yes executes unpinned remote package",
          { command: step.command, package: npx.packageName }
        )
      );
    }
  }

  if (/^npm\s+install\b/i.test(command.trim()) && lower.includes("postinstall")) {
    add(
      finding(
        "LIFECYCLE_HOOK",
        "error",
        "npm install may invoke package postinstall lifecycle scripts",
        { command }
      )
    );
  }

  const stats = {
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length
  };

  return {
    ok: stats.errors === 0,
    findings,
    stats,
    profile: PROFILE,
    command,
    pkgPath,
    chain
  };
}

export function analyzeCommand({ command, pkgText, pkgPath = "package.json" }) {
  const parsed = parsePackageJson(pkgText ?? "{}", pkgPath);
  if (!parsed.ok) {
    return {
      ok: false,
      profile: PROFILE,
      command,
      pkgPath,
      error: parsed.error,
      findings: [
        finding("INVALID_PACKAGE_JSON", "error", parsed.error, { pkgPath })
      ],
      stats: { errors: 1, warnings: 0 },
      chain: []
    };
  }

  const { chain, errors } = expandScriptChain({
    command,
    pkg: parsed.pkg,
    pkgPath
  });

  const bait = detectBaits({ command, chain, pkgPath });

  if (errors.length > 0) {
    for (const message of errors) {
      bait.findings.push(
        finding("EXPANSION_ERROR", "warning", message, { command })
      );
      bait.stats.warnings += 1;
    }
  }

  bait.ok = bait.stats.errors === 0;
  return bait;
}

export function scanPackageScripts({ pkgText, pkgPath = "package.json" }) {
  const parsed = parsePackageJson(pkgText, pkgPath);
  if (!parsed.ok) {
    return {
      ok: false,
      profile: PROFILE,
      pkgPath,
      error: parsed.error,
      scripts: [],
      stats: { errors: 1, warnings: 0, scripts: 0 }
    };
  }

  const scripts = scriptsMap(parsed.pkg);
  const results = [];
  let errors = 0;
  let warnings = 0;

  for (const [name, body] of Object.entries(scripts)) {
    const command = `npm run ${name}`;
    const analysis = analyzeCommand({
      command,
      pkgText,
      pkgPath
    });
    errors += analysis.stats.errors;
    warnings += analysis.stats.warnings;
    results.push({
      script: name,
      body: String(body),
      ok: analysis.ok,
      findings: analysis.findings,
      chain: analysis.chain
    });
  }

  return {
    ok: errors === 0,
    profile: PROFILE,
    pkgPath,
    scripts: results,
    stats: {
      errors,
      warnings,
      scripts: results.length
    }
  };
}

export function rulesReport() {
  return {
    profile: PROFILE,
    version: VERSION,
    rules: BAIT_RULES
  };
}

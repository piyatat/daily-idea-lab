/** @typedef {import("./parse.js").ParsedProject} ParsedProject */
/** @typedef {import("./parse.js").BuildScript} BuildScript */

/** @typedef {Object} Finding
 * @property {string} rule_id
 * @property {string} severity
 * @property {string} message
 * @property {Record<string, unknown>} details
 */

export const RULES = [
  {
    id: "BUILD_NET_FETCH",
    severity: "error",
    message: "Build script references network fetch/connect primitives",
  },
  {
    id: "BUILD_SHELL_EXEC",
    severity: "error",
    message: "Build script invokes shell or process execution",
  },
  {
    id: "BUILD_ENV_EXFIL",
    severity: "warn",
    message: "Build script reads sensitive environment variables",
  },
  {
    id: "LOCK_BAIT_BUILD_DEP",
    severity: "error",
    message: "Build-dependencies include bait or typosquat crate names",
  },
  {
    id: "PROC_MACRO_BUILD_CHAIN",
    severity: "error",
    message: "Build script plus proc-macro build dependency chain (arrayref-class pattern)",
  },
];

/** @type {Map<string, typeof RULES[number]>} */
const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

const NET_PATTERNS = [
  /\breqwest\b/,
  /\bureq\b/,
  /\bhyper\b/,
  /\bTcpStream\b/,
  /\bTcpListener\b/,
  /\bstd::net\b/,
  /\bconnect\s*\(/,
  /\bfetch\s*\(/,
  /\bUrl::parse\b/,
  /\bminreq\b/,
  /\bisahc\b/,
];

const EXEC_PATTERNS = [
  /\bCommand::new\b/,
  /\bstd::process::Command\b/,
  /\bprocess::Command\b/,
  /\bsh\s+-c\b/,
  /\bbash\s+-c\b/,
  /\bstd::process::exit\b/,
  /\bspawn\s*\(/,
];

const ENV_PATTERNS = [
  /\bstd::env::var\s*\(\s*"(?:CARGO_|HOME|USER|SSH|AWS|GITHUB|TOKEN|SECRET)/,
  /\benv::var\s*\(\s*"(?:CARGO_|HOME|USER|SSH|AWS|GITHUB|TOKEN|SECRET)/,
  /\bstd::env::vars\s*\(/,
];

const BAIT_CRATE_PATTERNS = [
  /^proc-macro1$/i,
  /^proc_macro1$/i,
  /^macro1$/i,
  /^build-script1$/i,
  /^cargo-build$/i,
  /^rustc-helper$/i,
  /-helper\d+$/i,
  /^arrayref$/i,
];

const SAFE_BUILD_DEPS = new Set([
  "cc",
  "cmake",
  "pkg-config",
  "bindgen",
  "autocfg",
  "version_check",
  "rustc_version",
  "capnpc",
  "tonic-build",
]);

/**
 * @param {BuildScript} script
 */
function scanBuildScript(script) {
  /** @type {Finding[]} */
  const findings = [];
  const content = script.content;

  for (const pattern of NET_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        rule_id: "BUILD_NET_FETCH",
        severity: "error",
        message: RULES[0].message,
        details: { file: script.relPath, pattern: pattern.source },
      });
      break;
    }
  }

  for (const pattern of EXEC_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        rule_id: "BUILD_SHELL_EXEC",
        severity: "error",
        message: RULES[1].message,
        details: { file: script.relPath, pattern: pattern.source },
      });
      break;
    }
  }

  for (const pattern of ENV_PATTERNS) {
    if (pattern.test(content)) {
      findings.push({
        rule_id: "BUILD_ENV_EXFIL",
        severity: "warn",
        message: RULES[2].message,
        details: { file: script.relPath, pattern: pattern.source },
      });
      break;
    }
  }

  return findings;
}

/**
 * @param {string} crateName
 */
function isBaitCrate(crateName) {
  return BAIT_CRATE_PATTERNS.some((pattern) => pattern.test(crateName));
}

/**
 * @param {string} crateName
 */
function isSafeBuildDep(crateName) {
  return SAFE_BUILD_DEPS.has(crateName);
}

/**
 * @param {ParsedProject} project
 */
export function evaluateRules(project) {
  /** @type {Finding[]} */
  const findings = [];

  for (const script of project.buildScripts) {
    findings.push(...scanBuildScript(script));
  }

  for (const manifest of project.manifests) {
    for (const [name] of Object.entries(manifest.buildDependencies)) {
      if (isBaitCrate(name)) {
        findings.push({
          rule_id: "LOCK_BAIT_BUILD_DEP",
          severity: "error",
          message: RULES[3].message,
          details: { manifest: manifest.relPath, crate: name },
        });
      }
    }

    const buildDepNames = Object.keys(manifest.buildDependencies);
    const manifestDir = manifest.relPath.replace(/Cargo\.toml$/, "");
    const hasBuildScript = project.buildScripts.some((script) => script.relPath.startsWith(manifestDir));

    if (hasBuildScript && buildDepNames.length > 0) {
      const suspicious = buildDepNames.filter((name) => !isSafeBuildDep(name));
      if (suspicious.length > 0) {
        findings.push({
          rule_id: "PROC_MACRO_BUILD_CHAIN",
          severity: "error",
          message: RULES[4].message,
          details: {
            manifest: manifest.relPath,
            build_deps: buildDepNames,
            suspicious,
          },
        });
      }
    }
  }

  for (const pkg of project.lockPackages) {
    if (isBaitCrate(pkg.name)) {
      findings.push({
        rule_id: "LOCK_BAIT_BUILD_DEP",
        severity: "error",
        message: RULES[3].message,
        details: { lock: project.lockPath, crate: pkg.name, version: pkg.version },
      });
    }
  }

  return dedupeFindings(findings);
}

/**
 * @param {Finding[]} findings
 */
function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((finding) => {
    const key = `${finding.rule_id}:${JSON.stringify(finding.details)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * @param {Finding[]} findings
 * @param {number} manifestCount
 */
export function formatJsonReport(findings, manifestCount) {
  const byRule = Object.fromEntries(RULES.map((rule) => [rule.id, 0]));
  for (const finding of findings) {
    byRule[finding.rule_id] = (byRule[finding.rule_id] ?? 0) + 1;
  }

  return {
    summary: {
      manifests: manifestCount,
      findings: findings.length,
      rules_fired: Object.values(byRule).filter((count) => count > 0).length,
      by_rule: byRule,
    },
    findings,
  };
}

/**
 * @param {Finding[]} findings
 */
export function formatFindings(findings) {
  if (findings.length === 0) {
    return "No build-script supply-chain bait detected.";
  }

  return findings
    .map((finding) => {
      const where = finding.details.file ?? finding.details.manifest ?? finding.details.lock ?? "";
      const suffix = where ? ` (${where})` : "";
      return `[${finding.severity}] ${finding.rule_id}: ${finding.message}${suffix}`;
    })
    .join("\n");
}

/**
 * @param {string} ruleId
 */
export function explainRule(ruleId) {
  const normalized = ruleId.trim().toUpperCase().replace(/-/g, "_");
  const rule = RULE_BY_ID.get(normalized);
  if (!rule) {
    throw new Error(`unknown rule: ${ruleId}`);
  }

  const hints = {
    BUILD_NET_FETCH:
      "Build scripts should not fetch remote payloads at compile time. Pin artifacts or use checked-in sources.",
    BUILD_SHELL_EXEC:
      "Avoid Command::new and shell outs in build.rs. Prefer cc/cmake crates with pinned toolchains.",
    BUILD_ENV_EXFIL:
      "Do not read token-like env vars in build scripts. Split secrets into runtime, not compile time.",
    LOCK_BAIT_BUILD_DEP:
      "Remove typosquat or bait build-dependencies (e.g. proc-macro1). Audit Cargo.lock after incidents.",
    PROC_MACRO_BUILD_CHAIN:
      "Review build.rs + build-dependencies together. arrayref-style attacks hide payloads behind build deps.",
  };

  return {
    id: rule.id,
    severity: rule.severity,
    message: rule.message,
    remediation: hints[rule.id] ?? "Audit build.rs and build-dependencies; run cargo audit and vet publishers.",
  };
}

/**
 * @param {string[]|undefined} failOn
 */
export function normalizeFailOn(failOn) {
  if (failOn == null) {
    return new Set(RULES.filter((rule) => rule.severity === "error").map((rule) => rule.id));
  }
  const normalized = failOn.map((item) => item.trim().toUpperCase().replace(/-/g, "_")).filter(Boolean);
  for (const id of normalized) {
    if (!RULE_BY_ID.has(id)) {
      throw new Error(`unknown rule in --fail-on: ${id}`);
    }
  }
  return new Set(normalized);
}

/**
 * @param {Finding[]} findings
 * @param {Set<string>|null} failOn
 */
export function shouldFail(findings, failOn) {
  if (findings.length === 0) return false;
  const active = failOn ?? new Set(RULES.filter((rule) => rule.severity === "error").map((rule) => rule.id));
  return findings.some((finding) => active.has(finding.rule_id));
}

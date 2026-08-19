/** @typedef {import("./parse.js").ReturnType<typeof import("./parse.js").parsePrBody>} ParsedBody */

/** @typedef {Object} Finding
 * @property {string} rule_id
 * @property {string} severity
 * @property {string} message
 * @property {Record<string, unknown>} details
 */

/** @typedef {Object} LintContext
 * @property {ParsedBody} parsed
 * @property {number|undefined} diffLines
 */

export const RULES = [
  {
    id: "DOC_TO_CODE_RATIO",
    severity: "error",
    message: "PR body lines dwarf the code change (AI;DR doc bloat)",
  },
  {
    id: "DESC_LENGTH_VS_DIFF",
    severity: "warn",
    message: "Very long description for a tiny code change",
  },
  {
    id: "BOILERPLATE_SECTIONS",
    severity: "warn",
    message: "Formulaic agent section outline without substance",
  },
  {
    id: "PROSE_SLOP_PACK",
    severity: "warn",
    message: "Marketing slop phrases common in unedited AI PR prose",
  },
  {
    id: "TEMPLATE_TRIFECTA",
    severity: "error",
    message: "Summary + Testing + Checklist template with hollow sections",
  },
  {
    id: "CHECKED_BOX_THEATER",
    severity: "warn",
    message: "All checkboxes checked with no open items or nuance",
  },
  {
    id: "VACUUM_RISK_SECTION",
    severity: "error",
    message: "Risk section present but empty or dismissive",
  },
  {
    id: "MISSING_NOT_TESTED",
    severity: "warn",
    message: "Testing section omits what was not tested on a non-trivial change",
  },
  {
    id: "UNCERTAINTY_SILENCE",
    severity: "warn",
    message: "Long PR body with zero uncertainty markers (overconfident agent voice)",
  },
  {
    id: "HEADING_STUFFING",
    severity: "warn",
    message: "Outline-as-description: too many headings for the body length",
  },
];

const RULE_BY_ID = new Map(RULES.map((rule) => [rule.id, rule]));

/**
 * @param {LintContext} context
 * @returns {Finding[]}
 */
export function evaluateRules(context) {
  /** @type {Finding[]} */
  const findings = [];
  const { parsed, diffLines } = context;

  if (parsed.nonEmptyLineCount <= 3) {
    return findings;
  }

  if (diffLines != null && diffLines > 0 && parsed.nonEmptyLineCount > diffLines * 3) {
    findings.push(makeFinding("DOC_TO_CODE_RATIO", {
      body_lines: parsed.nonEmptyLineCount,
      diff_lines: diffLines,
      ratio: Number((parsed.nonEmptyLineCount / diffLines).toFixed(2)),
    }, `Body has ${parsed.nonEmptyLineCount} non-empty lines for ${diffLines} changed line(s) (${(parsed.nonEmptyLineCount / diffLines).toFixed(1)}×)`));
  }

  if (parsed.lineCount > 200 && (diffLines == null || diffLines < 50)) {
    findings.push(makeFinding("DESC_LENGTH_VS_DIFF", {
      body_lines: parsed.lineCount,
      diff_lines: diffLines ?? null,
    }, `${parsed.lineCount} body lines for ${diffLines ?? "unknown"} changed line(s)`));
  }

  if (parsed.boilerplateSections.length >= 3) {
    findings.push(makeFinding("BOILERPLATE_SECTIONS", {
      sections: parsed.boilerplateSections.map((section) => section.title),
      count: parsed.boilerplateSections.length,
    }, `${parsed.boilerplateSections.length} boilerplate sections: ${parsed.boilerplateSections.map((section) => section.title).join(", ")}`));
  }

  if (parsed.slopHits.length >= 5) {
    findings.push(makeFinding("PROSE_SLOP_PACK", {
      hits: parsed.slopHits,
      count: parsed.slopHits.length,
    }, `${parsed.slopHits.length} slop phrase hits (${parsed.slopHits.slice(0, 4).join(", ")}…)`));
  }

  if (parsed.templateTriplet) {
    const hollow = ["summary", "testing", "checklist"]
      .map((name) => parsed.sections.find((section) => section.title.toLowerCase().includes(name)))
      .filter(Boolean)
      .filter((section) => section.substance < 40);

    if (hollow.length >= 2) {
      findings.push(makeFinding("TEMPLATE_TRIFECTA", {
        hollow_sections: hollow.map((section) => section.title),
      }, `Template trifecta with hollow sections: ${hollow.map((section) => section.title).join(", ")}`));
    }
  }

  if (parsed.checkedBoxes >= 4 && parsed.uncheckedBoxes === 0) {
    findings.push(makeFinding("CHECKED_BOX_THEATER", {
      checked: parsed.checkedBoxes,
      unchecked: parsed.uncheckedBoxes,
    }, `${parsed.checkedBoxes} checked boxes, zero open items`));
  }

  for (const section of parsed.riskSections) {
    const body = section.body.trim();
    const dismissive = /^(none|n\/a|low risk|should be fine|minimal|no known issues)\.?$/i.test(body);
    if (body.length < 20 || dismissive) {
      findings.push(makeFinding("VACUUM_RISK_SECTION", {
        section: section.title,
        body_preview: body.slice(0, 80) || "(empty)",
      }, `Risk section "${section.title}" is empty or dismissive`));
      break;
    }
  }

  if (
    parsed.testingSections.length > 0 &&
    parsed.notTestedHits.length === 0 &&
    diffLines != null &&
    diffLines > 20
  ) {
    findings.push(makeFinding("MISSING_NOT_TESTED", {
      diff_lines: diffLines,
      testing_sections: parsed.testingSections.map((section) => section.title),
    }, `Testing section present but no "not tested" disclosure for ${diffLines}-line change`));
  }

  if (parsed.lineCount > 80 && parsed.uncertaintyHits.length === 0) {
    findings.push(makeFinding("UNCERTAINTY_SILENCE", {
      body_lines: parsed.lineCount,
    }, `${parsed.lineCount}-line body with zero uncertainty markers`));
  }

  if (parsed.h2h3Count > 8 && parsed.lineCount < 150) {
    findings.push(makeFinding("HEADING_STUFFING", {
      headings: parsed.h2h3Count,
      body_lines: parsed.lineCount,
    }, `${parsed.h2h3Count} H2/H3 headings in ${parsed.lineCount} lines`));
  }

  return findings;
}

/**
 * @param {string} ruleId
 * @param {Record<string, unknown>} details
 * @param {string} message
 */
function makeFinding(ruleId, details, message) {
  const rule = RULE_BY_ID.get(ruleId);
  return {
    rule_id: ruleId,
    severity: rule?.severity ?? "warn",
    message,
    details,
  };
}

/**
 * @param {Finding[]} findings
 * @param {number} bodyLines
 */
export function formatJsonReport(findings, bodyLines) {
  const byRule = Object.fromEntries(RULES.map((rule) => [rule.id, 0]));
  for (const finding of findings) {
    byRule[finding.rule_id] = (byRule[finding.rule_id] ?? 0) + 1;
  }

  return {
    summary: {
      body_lines: bodyLines,
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
    return "No PR prose noise detected.";
  }

  return findings
    .map((finding) => `[${finding.severity}] ${finding.rule_id}: ${finding.message}`)
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
    DOC_TO_CODE_RATIO: "Keep PR prose proportional to the diff. Pass --diff-lines from git diff --stat.",
    DESC_LENGTH_VS_DIFF: "Short fixes need short descriptions. Cut template sections on tiny changes.",
    BOILERPLATE_SECTIONS: "Replace generic Summary/Testing/Notes headers with file-specific bullets.",
    PROSE_SLOP_PACK: "Delete marketing adjectives. State what changed and what you are unsure about.",
    TEMPLATE_TRIFECTA: "Do not ship hollow Summary + Testing + Checklist shells. Add substance or remove sections.",
    CHECKED_BOX_THEATER: "Leave at least one open item or describe manual gaps instead of all-green theater.",
    VACUUM_RISK_SECTION: "Risk sections must name concrete concerns, not None/N/A.",
    MISSING_NOT_TESTED: 'Add explicit "Not tested: …" lines for paths you did not verify.',
    UNCERTAINTY_SILENCE: "Long agent PRs should flag assumptions, TODO verify items, or open questions.",
    HEADING_STUFFING: "Merge outline sections; reviewers need signal, not a table of contents.",
  };

  return {
    id: rule.id,
    severity: rule.severity,
    message: rule.message,
    remediation: hints[rule.id] ?? "Trim prose; highlight risks and untested paths.",
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

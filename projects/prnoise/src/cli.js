import { lintFile } from "./lint.js";
import { RULES, explainRule } from "./rules.js";

const HELP = `prnoise — fail-closed linter for AI;DR PR prose

Usage:
  prnoise lint <file|-> [options]
  prnoise rules
  prnoise explain <rule-id>

Commands:
  lint      Lint a PR body markdown file (use - for stdin)
  rules     List rule IDs, severities, and descriptions
  explain   Show remediation guidance for one rule

Lint options:
  --diff-lines <n>       Changed lines from git diff --stat (enables ratio rules)
  --json                 Print JSON report
  --fail-on <rules>      Comma-separated rule IDs that fail the process (default: error severity)
  -h, --help             Show help

Examples:
  prnoise lint fixtures/ai-slop-wall.pr.md
  gh pr view 42 --json body -q .body | prnoise lint - --diff-lines 24
  prnoise lint body.md --fail-on PROSE_SLOP_PACK,TEMPLATE_TRIFECTA --json
  prnoise explain VACUUM_RISK_SECTION
`;

/**
 * @param {string[]} argv
 */
export async function run(argv) {
  const args = [...argv];
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    console.log(HELP.trim());
    return 0;
  }

  const command = args.shift();
  if (command === "rules") {
    for (const rule of RULES) {
      console.log(`${rule.id}\t[${rule.severity}]\t${rule.message}`);
    }
    return 0;
  }

  if (command === "explain") {
    const ruleId = args.shift();
    if (!ruleId) {
      throw new Error("explain requires a rule id");
    }
    const info = explainRule(ruleId);
    console.log(`${info.id} [${info.severity}]`);
    console.log(info.message);
    console.log(`\nRemediation: ${info.remediation}`);
    return 0;
  }

  if (command !== "lint") {
    throw new Error(`unknown command: ${command}`);
  }

  let filePath = "-";
  if (args.length > 0 && !args[0].startsWith("-")) {
    filePath = args.shift() ?? "-";
  }

  let asJson = false;
  /** @type {string[]|undefined} */
  let failOn;
  /** @type {number|undefined} */
  let diffLines;

  while (args.length > 0) {
    const flag = args.shift();
    switch (flag) {
      case "--json":
        asJson = true;
        break;
      case "--fail-on":
        failOn = readList(args.shift(), "--fail-on");
        break;
      case "--diff-lines":
        diffLines = readNumber(args.shift(), "--diff-lines");
        break;
      default:
        throw new Error(`unknown option: ${flag}`);
    }
  }

  const result = await lintFile(filePath, { asJson, failOn, diffLines });

  if (asJson) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(result.text);
    if (result.findings.length > 0) {
      console.log(
        `\nScanned ${result.report.summary.body_lines} body line(s); ${result.findings.length} finding(s).`,
      );
    }
  }

  return result.exitCode;
}

/** @param {string|undefined} value @param {string} flag */
function readList(value, flag) {
  if (value == null || !value.trim()) {
    throw new Error(`${flag} requires a comma-separated rule list`);
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

/** @param {string|undefined} value @param {string} flag */
function readNumber(value, flag) {
  if (value == null || !value.trim()) {
    throw new Error(`${flag} requires a number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative number`);
  }
  return parsed;
}

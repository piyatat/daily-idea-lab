import { scanFile } from "./scan.js";
import { RULES } from "./rules.js";

const HELP = `seqtax — quantify sequential tool-call tax in agent session JSONL

Usage:
  seqtax scan <trace.jsonl> [options]
  seqtax rules

Commands:
  scan     Analyze session JSONL for missed parallelism, duplicates, and stuck loops
  rules    List rule IDs and descriptions

Scan options:
  --json                 Print JSON report
  --fail-on <rules>      Comma-separated rule IDs that fail the process (default: all)
  -h, --help             Show help

Rules:
  PARALLEL_GROUP   Sequential read-only calls that could run in parallel
  DUPLICATE_CALL   Identical tool+args repeated in the session
  STUCK_LOOP       Same tool+args invoked three or more times in a row

Examples:
  seqtax scan fixtures/sequential-reads.jsonl
  seqtax scan trace.jsonl --json
  seqtax scan trace.jsonl --fail-on PARALLEL_GROUP,STUCK_LOOP
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

  if (command !== "scan") {
    throw new Error(`unknown command: ${command}`);
  }

  if (args.length === 0 || args[0].startsWith("-")) {
    throw new Error("scan requires a trace.jsonl path");
  }

  const filePath = args.shift();
  let asJson = false;
  /** @type {string[]|undefined} */
  let failOn;

  while (args.length > 0) {
    const flag = args.shift();
    switch (flag) {
      case "--json":
        asJson = true;
        break;
      case "--fail-on":
        failOn = readList(args.shift(), "--fail-on");
        break;
      default:
        throw new Error(`unknown option: ${flag}`);
    }
  }

  const result = scanFile(filePath, { asJson, failOn });

  for (const warning of result.warnings) {
    console.error(`warning: ${warning}`);
  }

  if (asJson) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(result.text);
    if (result.findings.length > 0) {
      console.log(
        `\nScanned ${result.report.summary.tool_calls} tool call(s); ${result.findings.length} finding(s); ~${result.report.summary.saved_round_trips} round-trip(s) recoverable.`,
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

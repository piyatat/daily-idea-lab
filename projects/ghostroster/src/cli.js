import { analyzeSession, formatReport, shouldFail } from "./analyze.js";
import { loadEvents } from "./parse.js";

const HELP = `ghostroster — find stale subagents in agent session exports

Usage:
  ghostroster scan <session.jsonl> [options]

Options:
  --stale-hours <n>     Flag running agents idle longer than n hours (default: 24)
  --max-depth <n>       Flag spawn trees deeper than n (default: 5)
  --poll-threshold <n>  Flag identical tool repeats within 30m (default: 5)
  --root-agent <id>     Root agent id for orphan tool calls (default: __root__)
  --json                Print JSON report
  --fail                Exit 1 when critical/high findings exist
  -h, --help            Show help

Examples:
  ghostroster scan rollout.jsonl
  ghostroster scan session.jsonl --stale-hours 6 --fail
  ghostroster scan session.jsonl --json > report.json
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
  if (command !== "scan") {
    throw new Error(`unknown command: ${command}`);
  }

  if (args.length === 0 || args[0].startsWith("-")) {
    throw new Error("scan requires a session.jsonl path");
  }

  const filePath = args.shift();
  const options = {
    staleHours: 24,
    maxDepth: 5,
    pollThreshold: 5,
    rootAgentId: undefined,
  };
  let asJson = false;
  let failOnFindings = false;

  while (args.length > 0) {
    const flag = args.shift();
    switch (flag) {
      case "--stale-hours":
        options.staleHours = readNumber(args.shift(), "--stale-hours");
        break;
      case "--max-depth":
        options.maxDepth = readNumber(args.shift(), "--max-depth");
        break;
      case "--poll-threshold":
        options.pollThreshold = readNumber(args.shift(), "--poll-threshold");
        break;
      case "--root-agent":
        options.rootAgentId = readString(args.shift(), "--root-agent");
        break;
      case "--json":
        asJson = true;
        break;
      case "--fail":
        failOnFindings = true;
        break;
      default:
        throw new Error(`unknown option: ${flag}`);
    }
  }

  const events = loadEvents(filePath);
  const report = analyzeSession(events, options);

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  if (failOnFindings && shouldFail(report)) {
    return 1;
  }
  return 0;
}

/** @param {string|undefined} value @param {string} flag */
function readNumber(value, flag) {
  if (value == null) throw new Error(`${flag} requires a number`);
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${flag} must be a positive number`);
  }
  return num;
}

/** @param {string|undefined} value @param {string} flag */
function readString(value, flag) {
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

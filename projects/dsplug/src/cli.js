import { checkDirectory, checkPatchFile } from "./check.js";
import { checkStack } from "./stack.js";
import { RULES } from "./rules.js";

const HELP = `dsplug — linter for DeepSeek Harness Cordis plugin bundles

Usage:
  dsplug check <plugin-dir> [options]
  dsplug patch <cordis.patch.yml> [options]
  dsplug stack <patch1.yml> <patch2.yml> ... [options]
  dsplug rules

Commands:
  check    Validate package.json dsh metadata and referenced cordis.patch.yml
  patch    Validate a standalone cordis.patch.yml file
  stack    Validate ordered bundle/profile patch layers (base → overlays)
  rules    List rule IDs and descriptions

Options:
  --json                 Print JSON report
  --fail-on <rules>      Comma-separated rule IDs that fail the process (default: all errors)
  -h, --help             Show help

Rules:
  DUPLICATE_ROW_ID       Duplicate plugin row id in the same patch file
  MISSING_PATCH_FILE     dsh.bundle.patch points to a missing file
  MISSING_ROW_ID         Insert row missing id
  MISSING_ROW_NAME       Insert row missing npm package name
  EMPTY_INSERT           Insert block with no rows
  UNRESOLVED_TARGET      Override targets a row id absent from earlier stack layers
  UNSCOPED_PLUGIN_NAME   Plugin name not scoped (@org/pkg) — warning
  ORPHAN_PATCH           cordis.patch.yml without dsh metadata — warning

Examples:
  dsplug check ./my-dsh-plugin
  dsplug patch fixtures/valid-bundle/cordis.patch.yml
  dsplug stack fixtures/stack/base.patch.yml fixtures/stack/headless.patch.yml
  dsplug check . --json --fail-on DUPLICATE_ROW_ID,UNRESOLVED_TARGET
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

  if (!["check", "patch", "stack"].includes(command)) {
    throw new Error(`unknown command: ${command}`);
  }

  /** @type {string[]} */
  const paths = [];
  let asJson = false;
  /** @type {string[]|undefined} */
  let failOn;

  while (args.length > 0) {
    const token = args[0];
    if (token.startsWith("-")) {
      args.shift();
      switch (token) {
        case "--json":
          asJson = true;
          break;
        case "--fail-on":
          failOn = readList(args.shift(), "--fail-on");
          break;
        default:
          throw new Error(`unknown option: ${token}`);
      }
    } else {
      paths.push(args.shift());
    }
  }

  if (paths.length === 0) {
    throw new Error(`${command} requires at least one path`);
  }

  const options = { asJson, failOn };
  const result =
    command === "check"
      ? checkDirectory(paths[0], options)
      : command === "patch"
        ? checkPatchFile(paths[0], options)
        : checkStack(paths, options);

  if (asJson) {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    console.log(result.text);
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

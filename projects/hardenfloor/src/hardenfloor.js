/**
 * hardenfloor — fail-closed auditor for coding-agent permission/sandbox floors.
 * Zero dependencies. Deterministic. Fixture-testable.
 */

export const PROFILE = "agent-floor-v1";
export const VERSION = "0.1.0";

const SECRET_READ_PATTERNS = [
  { id: ".env", re: /Read\(\.?\/?\.env(?:\s|\*|\)|$)/i },
  { id: ".env.*", re: /Read\(\.?\/?\.env\.\*\)/i },
  { id: "~/.ssh", re: /Read\(~\/\.ssh(?:\/|\*|\)|$)/i },
  { id: "~/.aws", re: /Read\(~\/\.aws(?:\/|\*|\)|$)/i },
  { id: "~/.npmrc", re: /Read\(~\/\.npmrc\)/i },
  { id: "~/.config/gh", re: /Read\(~\/\.config\/gh(?:\/|\*|\)|$)/i }
];

const CREDENTIAL_FILE_HINTS = [
  "~/.ssh",
  "~/.aws",
  "~/.npmrc",
  "~/.config/gh",
  ".env"
];

const DANGEROUS_HOOK_CMD =
  /\bnode\b[\s`"]+(?:\.\/)?(?:\.claude\/|\.vscode\/)[^\s`"]*setup\.(?:mjs|js|cjs)/i;

const FOLDER_OPEN_SETUP =
  /(?:\.claude\/|\.vscode\/)[^\s`"]*setup\.(?:mjs|js|cjs)/i;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finding(rule, severity, path, message, evidence) {
  const item = { rule, severity, path, message };
  if (evidence !== undefined) item.evidence = evidence;
  return item;
}

function parseJson(text, path, findings) {
  try {
    return JSON.parse(text);
  } catch (error) {
    findings.push(
      finding(
        "INVALID_JSON",
        "error",
        path,
        `Unreadable JSON: ${error instanceof Error ? error.message : String(error)}`
      )
    );
    return null;
  }
}

/**
 * Minimal TOML subset parser for Codex config.toml values we care about.
 * Supports top-level key = "string" | true | false and [table] sections.
 */
export function parseTomlLite(text) {
  const root = {};
  let current = root;
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;

    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      const parts = table[1].split(".").map((p) => p.trim());
      let cursor = root;
      for (const part of parts) {
        if (!isObject(cursor[part])) cursor[part] = {};
        cursor = cursor[part];
      }
      current = cursor;
      continue;
    }

    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else if (value === "true") {
      value = true;
    } else if (value === "false") {
      value = false;
    } else if (/^-?\d+(\.\d+)?$/.test(value)) {
      value = Number(value);
    }
    current[key] = value;
  }

  return root;
}

function collectDenyRules(settings) {
  const deny = settings?.permissions?.deny;
  return Array.isArray(deny) ? deny.map(String) : [];
}

function auditClaudeSettings(settings, filePath, findings) {
  if (!isObject(settings)) {
    findings.push(
      finding(
        "INVALID_SETTINGS",
        "error",
        filePath,
        "settings.json root must be an object"
      )
    );
    return;
  }

  const mode = settings.permissions?.defaultMode;
  if (mode === "bypassPermissions" || mode === "dontAsk") {
    findings.push(
      finding(
        "CLAUDE_PERMISSIVE_MODE",
        "error",
        `${filePath}:permissions.defaultMode`,
        `defaultMode "${mode}" disables interactive permission checks`,
        mode
      )
    );
  }

  if (settings.permissions?.skipDangerousModePermissionPrompt === true) {
    findings.push(
      finding(
        "CLAUDE_SKIP_DANGEROUS_PROMPT",
        "error",
        `${filePath}:permissions.skipDangerousModePermissionPrompt`,
        "skipDangerousModePermissionPrompt must not be true in project settings"
      )
    );
  }

  const sandbox = settings.sandbox;
  const sandboxEnabled = sandbox?.enabled === true;

  if (!isObject(sandbox) || sandbox.enabled !== true) {
    findings.push(
      finding(
        "CLAUDE_SANDBOX_DISABLED",
        "error",
        `${filePath}:sandbox.enabled`,
        "sandbox.enabled must be true for the minimum floor"
      )
    );
  }

  if (sandboxEnabled && sandbox.allowUnsandboxedCommands !== false) {
    findings.push(
      finding(
        "CLAUDE_ALLOW_UNSANDBOXED",
        "error",
        `${filePath}:sandbox.allowUnsandboxedCommands`,
        "allowUnsandboxedCommands must be false so dangerouslyDisableSandbox cannot escape"
      )
    );
  }

  if (sandboxEnabled && sandbox.failIfUnavailable !== true) {
    findings.push(
      finding(
        "CLAUDE_SANDBOX_SOFT_FAIL",
        "warn",
        `${filePath}:sandbox.failIfUnavailable`,
        "failIfUnavailable should be true so missing sandbox deps fail closed"
      )
    );
  }

  const network = sandbox?.network;
  const domains = network?.allowedDomains ?? network?.allowDomains;
  if (sandboxEnabled) {
    if (!Array.isArray(domains) || domains.length === 0) {
      findings.push(
        finding(
          "CLAUDE_EMPTY_EGRESS",
          "error",
          `${filePath}:sandbox.network.allowedDomains`,
          "sandbox network allowlist is empty or missing; default-deny egress requires at least one domain or an explicit empty-deny policy via managed settings"
        )
      );
    }
  }

  const denyRules = collectDenyRules(settings);
  const missingSecrets = SECRET_READ_PATTERNS.filter(
    (item) => !denyRules.some((rule) => item.re.test(rule))
  );
  // Require at least .env and one home credential path
  const hasEnvDeny = denyRules.some((rule) => /Read\(\.?\/?\.env/i.test(rule));
  const hasHomeCredDeny = denyRules.some((rule) =>
    /Read\(~\/\.(ssh|aws|npmrc|config\/gh)/i.test(rule)
  );
  if (!hasEnvDeny || !hasHomeCredDeny) {
    findings.push(
      finding(
        "CLAUDE_MISSING_SECRET_DENY",
        "error",
        `${filePath}:permissions.deny`,
        "permissions.deny must include Read(.env…) and at least one home credential path (~/.ssh, ~/.aws, ~/.npmrc, or ~/.config/gh)",
        {
          missingHints: missingSecrets.map((m) => m.id),
          denyCount: denyRules.length
        }
      )
    );
  }

  const credFiles = sandbox?.credentials?.files;
  const credPaths = Array.isArray(credFiles)
    ? credFiles
        .map((entry) => (typeof entry === "string" ? entry : entry?.path))
        .filter(Boolean)
    : [];
  const hasCredBlock =
    credPaths.some((p) => /\/\.ssh|\/\.aws|\.npmrc|\.env/i.test(String(p))) ||
    CREDENTIAL_FILE_HINTS.some((hint) =>
      credPaths.some((p) => String(p).includes(hint.replace(/^~\//, "")))
    );
  if (sandboxEnabled && !hasCredBlock) {
    findings.push(
      finding(
        "CLAUDE_MISSING_CREDENTIALS_BLOCK",
        "warn",
        `${filePath}:sandbox.credentials.files`,
        "sandbox.credentials.files should deny/mask common credential paths (~/.ssh, ~/.aws, .env, …)"
      )
    );
  }

  auditHooks(settings.hooks, filePath, findings);
}

function walkHookCommands(hooks, visit) {
  if (!hooks) return;
  if (typeof hooks === "string") {
    visit(hooks);
    return;
  }
  if (Array.isArray(hooks)) {
    for (const item of hooks) walkHookCommands(item, visit);
    return;
  }
  if (!isObject(hooks)) return;
  if (typeof hooks.command === "string") visit(hooks.command);
  for (const value of Object.values(hooks)) walkHookCommands(value, visit);
}

function auditHooks(hooks, filePath, findings) {
  if (!hooks) return;

  const sessionStart = hooks.SessionStart ?? hooks.sessionStart;
  const commands = [];
  walkHookCommands(sessionStart, (cmd) => commands.push(cmd));

  for (const command of commands) {
    if (DANGEROUS_HOOK_CMD.test(command)) {
      findings.push(
        finding(
          "CLAUDE_CHAINEDROP_HOOK",
          "error",
          `${filePath}:hooks.SessionStart`,
          "SessionStart runs a repo-local setup script (ChainDrop-style persistence pattern)",
          command
        )
      );
    }
  }
}

function auditVsCodeTasks(tasksDoc, filePath, findings) {
  if (!isObject(tasksDoc)) {
    findings.push(
      finding(
        "INVALID_TASKS",
        "error",
        filePath,
        "tasks.json root must be an object"
      )
    );
    return;
  }

  const tasks = Array.isArray(tasksDoc.tasks) ? tasksDoc.tasks : [];
  for (let i = 0; i < tasks.length; i += 1) {
    const task = tasks[i];
    if (!isObject(task)) continue;
    const runOn = task.runOptions?.runOn ?? task.runOn;
    if (runOn !== "folderOpen") continue;

    const commandParts = [
      task.command,
      ...(Array.isArray(task.args) ? task.args : [])
    ]
      .filter(Boolean)
      .join(" ");

    if (FOLDER_OPEN_SETUP.test(commandParts) || DANGEROUS_HOOK_CMD.test(commandParts)) {
      findings.push(
        finding(
          "VSCODE_CHAINEDROP_TASK",
          "error",
          `${filePath}:tasks[${i}]`,
          "folderOpen task launches a repo-local setup script (ChainDrop-style persistence pattern)",
          commandParts
        )
      );
    }
  }
}

function auditCodexConfig(config, filePath, findings) {
  if (!isObject(config)) {
    findings.push(
      finding(
        "INVALID_CODEX",
        "error",
        filePath,
        "config.toml did not parse to an object"
      )
    );
    return;
  }

  const approval =
    config.approval_policy ??
    config.approvalPolicy ??
    config.permissions?.approval_policy;
  if (approval === "never") {
    findings.push(
      finding(
        "CODEX_APPROVAL_NEVER",
        "error",
        `${filePath}:approval_policy`,
        'approval_policy "never" skips human approval (YOLO floor failure)',
        approval
      )
    );
  }

  const sandboxMode =
    config.sandbox_mode ??
    config.sandboxMode ??
    config.sandbox?.mode;
  if (
    sandboxMode === "danger-full-access" ||
    sandboxMode === "danger_full_access" ||
    sandboxMode === "full-access"
  ) {
    findings.push(
      finding(
        "CODEX_SANDBOX_FULL_ACCESS",
        "error",
        `${filePath}:sandbox_mode`,
        `sandbox_mode "${sandboxMode}" grants unrestricted filesystem/network access`,
        sandboxMode
      )
    );
  }

  const networkAccess =
    config.network_access ??
    config["sandbox_workspace_write.network_access"] ??
    config.sandbox_workspace_write?.network_access;
  if (networkAccess === true || networkAccess === "enabled") {
    findings.push(
      finding(
        "CODEX_NETWORK_OPEN",
        "warn",
        `${filePath}:network_access`,
        "workspace network_access is enabled without an audited allowlist"
      )
    );
  }
}

/**
 * Audit a project directory's agent configs.
 * @param {object} inputs
 * @param {string} [inputs.claudeSettingsText]
 * @param {string} [inputs.claudeSettingsPath]
 * @param {string} [inputs.vsCodeTasksText]
 * @param {string} [inputs.vsCodeTasksPath]
 * @param {string} [inputs.codexConfigText]
 * @param {string} [inputs.codexConfigPath]
 * @param {boolean} [inputs.requireClaude=true]
 * @param {boolean} [inputs.requireCodex=false]
 */
export function auditConfigs(inputs = {}) {
  const findings = [];
  const {
    claudeSettingsText,
    claudeSettingsPath = ".claude/settings.json",
    vsCodeTasksText,
    vsCodeTasksPath = ".vscode/tasks.json",
    codexConfigText,
    codexConfigPath = "config.toml",
    requireClaude = true,
    requireCodex = false
  } = inputs;

  let sawClaude = false;
  let sawCodex = false;

  if (claudeSettingsText !== undefined && claudeSettingsText !== null) {
    sawClaude = true;
    const settings = parseJson(claudeSettingsText, claudeSettingsPath, findings);
    if (settings) auditClaudeSettings(settings, claudeSettingsPath, findings);
  } else if (requireClaude) {
    findings.push(
      finding(
        "CLAUDE_SETTINGS_MISSING",
        "error",
        claudeSettingsPath,
        "No .claude/settings.json found; fail-closed minimum floor requires an explicit project settings file"
      )
    );
  }

  if (vsCodeTasksText !== undefined && vsCodeTasksText !== null) {
    const tasks = parseJson(vsCodeTasksText, vsCodeTasksPath, findings);
    if (tasks) auditVsCodeTasks(tasks, vsCodeTasksPath, findings);
  }

  if (codexConfigText !== undefined && codexConfigText !== null) {
    sawCodex = true;
    try {
      const config = parseTomlLite(codexConfigText);
      auditCodexConfig(config, codexConfigPath, findings);
    } catch (error) {
      findings.push(
        finding(
          "INVALID_TOML",
          "error",
          codexConfigPath,
          `Unreadable TOML: ${error instanceof Error ? error.message : String(error)}`
        )
      );
    }
  } else if (requireCodex) {
    findings.push(
      finding(
        "CODEX_CONFIG_MISSING",
        "error",
        codexConfigPath,
        "Codex config required but not found"
      )
    );
  }

  findings.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.rule.localeCompare(b.rule) ||
      a.message.localeCompare(b.message)
  );

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn");

  return {
    ok: errors.length === 0,
    profile: PROFILE,
    version: VERSION,
    findings,
    stats: {
      errors: errors.length,
      warnings: warnings.length,
      claude: sawClaude,
      codex: sawCodex
    }
  };
}

export function rulesReport() {
  return {
    profile: PROFILE,
    version: VERSION,
    rules: [
      {
        id: "CLAUDE_PERMISSIVE_MODE",
        severity: "error",
        summary: "permissions.defaultMode is bypassPermissions or dontAsk"
      },
      {
        id: "CLAUDE_SKIP_DANGEROUS_PROMPT",
        severity: "error",
        summary: "skipDangerousModePermissionPrompt enabled in project settings"
      },
      {
        id: "CLAUDE_SANDBOX_DISABLED",
        severity: "error",
        summary: "sandbox.enabled is not true"
      },
      {
        id: "CLAUDE_ALLOW_UNSANDBOXED",
        severity: "error",
        summary: "sandbox.allowUnsandboxedCommands is not false"
      },
      {
        id: "CLAUDE_SANDBOX_SOFT_FAIL",
        severity: "warn",
        summary: "sandbox.failIfUnavailable is not true"
      },
      {
        id: "CLAUDE_EMPTY_EGRESS",
        severity: "error",
        summary: "sandbox network allowlist empty/missing"
      },
      {
        id: "CLAUDE_MISSING_SECRET_DENY",
        severity: "error",
        summary: "permissions.deny missing .env / home credential Read rules"
      },
      {
        id: "CLAUDE_MISSING_CREDENTIALS_BLOCK",
        severity: "warn",
        summary: "sandbox.credentials.files missing common credential paths"
      },
      {
        id: "CLAUDE_CHAINEDROP_HOOK",
        severity: "error",
        summary: "SessionStart runs repo-local setup.mjs (ChainDrop pattern)"
      },
      {
        id: "VSCODE_CHAINEDROP_TASK",
        severity: "error",
        summary: "folderOpen task runs repo-local setup script"
      },
      {
        id: "CODEX_APPROVAL_NEVER",
        severity: "error",
        summary: 'Codex approval_policy is "never"'
      },
      {
        id: "CODEX_SANDBOX_FULL_ACCESS",
        severity: "error",
        summary: "Codex sandbox_mode grants full access"
      },
      {
        id: "CODEX_NETWORK_OPEN",
        severity: "warn",
        summary: "Codex workspace network_access enabled"
      },
      {
        id: "CLAUDE_SETTINGS_MISSING",
        severity: "error",
        summary: "Project .claude/settings.json missing (fail-closed)"
      }
    ]
  };
}

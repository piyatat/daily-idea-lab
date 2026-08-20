# assistscan

Fail-closed scanner for **OpenAI Assistants API** call sites before the **Aug 26, 2026** permanent shutdown.

OpenAI removes `/v1/assistants`, `/v1/threads`, and run/poll loops on that date — no grace period, no automated Thread→Conversation migration. Wire this into CI so a stray `beta.threads` import cannot ship after you migrate.

Zero runtime dependencies. Node **≥ 22.13**.

## Install

```bash
cd projects/assistscan
npm link   # optional — puts assistscan on PATH
```

## Usage

```bash
assistscan scan .
assistscan scan ./src --json
assistscan scan . --fail-on BETA_THREADS,V1_THREADS_URL
assistscan deadline
assistscan rules
assistscan explain BETA_ASSISTANTS
```

## What it catches

| Rule | Severity | Example |
| --- | --- | --- |
| `BETA_ASSISTANTS` | error | `openai.beta.assistants.create(...)` |
| `BETA_THREADS` | error | `client.beta.threads.messages.list(...)` |
| `V1_ASSISTANTS_URL` | error | `fetch("https://api.openai.com/v1/assistants")` |
| `V1_THREADS_URL` | error | `POST /v1/threads` |
| `THREADS_RUNS` | error | `beta.threads.runs.create(...)` |
| `ASSISTANTS_RUN` | error | `threads.createAndRun(...)` |
| `AZURE_ASSISTANTS` | error | Azure OpenAI Assistants endpoint references |
| `ASSISTANT_ID_REF` | warn | `assistant_id` in config/env |
| `THREAD_ID_REF` | warn | stored `thread_id` pointers |
| `OPENAI_ASSISTANT_IMPORT` | warn | `AssistantCreateParams` type imports |

Default `--fail-on` is all **error** rules. Exit code **1** when matches hit your fail set; **0** when clean.

## CI example

```yaml
- name: Block Assistants API call sites
  run: |
    npx assistscan deadline
    npx assistscan scan . --json --fail-on BETA_ASSISTANTS,BETA_THREADS,V1_THREADS_URL
```

## Test

```bash
npm test
npm run check
```

## Migration pointers

- **Assistants** → Prompts (dashboard) or inline `responses.create` config
- **Threads** → Conversations API or `previous_response_id`
- **Runs** → synchronous `responses.create` + explicit tool loops
- **Azure** → Microsoft Foundry Agents (same Aug 26, 2026 date)

Not legal advice; verify against [OpenAI's migration guide](https://developers.openai.com/api/docs/assistants/migration).

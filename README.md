# ⚠️ DEPRECATED: Moved to [brainrouter](https://github.com/papa/brainrouter)

> **Note**: This project is now part of [brainrouter](https://github.com/papa/brainrouter). All new development, features, and bug fixes are happening there.

Pingpong is an MCP server for [oh-my-pi](https://github.com/can1357/oh-my-pi) that gives your AI agent a local code reviewer. After completing work, the agent calls `request_review`. Pingpong sends the git diff, PRD, and task context to a local LLM (llama.cpp) which reviews the work and returns structured feedback — all within the same tool call. The agent revises and retries inside one premium cloud request. A browser-based escalation UI handles the cases the local LLM cannot resolve.

Optionally, a model router selects the cheapest sufficient model for each task, routing through a LiteLLM proxy.

---

## Quick Start

### oh-my-pi (recommended)

```bash
curl -sSL https://raw.githubusercontent.com/ajaxdude/pingpong/master/install.sh | bash
```

The installer:
- Clones this repo into `~/.omp/skills/pingpong/`
- Builds the TypeScript
- Installs `node_modules` into the skill folder
- Writes `~/.omp/agent/mcp.json` pointing at `~/.omp/skills/pingpong/dist/mcp.js`
- Injects `templates/APPEND_SYSTEM.md` and `templates/LLAMACPP.md` into your agent config

After installing, create `pingpong.config.json` in each project where you want reviews (see [Configuration](#configuration)).

### Manual

```bash
git clone https://github.com/ajaxdude/pingpong.git
cd pingpong
npm install && npm run build
```

Add to your MCP config:

```json
{
  "mcpServers": {
    "pingpong": {
      "type": "stdio",
      "command": "node",
      "args": ["/absolute/path/to/pingpong/dist/mcp.js"]
    }
  }
}
```

---

## How It Works

1. Your agent completes a task and calls `request_review`.
2. Pingpong creates a session and blocks until the review resolves.
3. Pingpong reads the local `pingpong.config.json`, collects the git diff, PRD, and any `AGENTS.md`.
4. The local LLM (llama.cpp) reviews the context and responds with a JSON verdict:
   `{ "status": "approved" | "needs_revision" | "escalated", "feedback": "..." }`
5. On `needs_revision`: feedback is added to session history and the loop continues (up to `maxIterations`).
6. On `approved`: `request_review` returns the verdict to the agent immediately.
7. On `escalated` or LLM failure: the browser UI opens at `http://localhost:3458/review-requests` for human review.

The agent receives the **final resolved status** from `request_review` — never a `pending` response that requires polling.

---

## MCP Tools

### `request_review`

Submit completed work for automated review. Blocks until the review reaches a terminal state.

**Input:**
| Field | Type | Required | Description |
|---|---|---|---|
| `taskId` | string | Yes | Format: `[type]-[date]-[seq]`, e.g. `feature-20260314-001` |
| `summary` | string | Yes | 2–3 sentences: what changed, why, assumptions |
| `details` | string | No | Additional context, edge cases, security notes |
| `conversationHistory` | string[] | No | Prior conversation turns for context |

**Return:**
```json
{
  "status": "approved",
  "feedback": "Looks good. Error handling is solid.",
  "sessionId": "abc123",
  "iterationCount": 2,
  "reviewerType": "llm"
}
```

`status` is always terminal: `approved`, `needs_revision`, or `escalated`. The agent should treat `needs_revision` as a directive to fix and re-submit.

**What gets reviewed:**
- Git diff (`git diff HEAD`)
- Project PRD (auto-detected from `./docs/PRD.md`, `./PRD.md`, or `./README.md`)
- `AGENTS.md` if present
- Built-in criteria: correctness, security, performance, maintainability, test coverage, documentation

---

### `get_session_list`

Returns all sessions (for debugging or the dashboard).

```json
{
  "sessions": [
    { "id": "abc123", "taskId": "feature-20260314-001", "status": "approved", "summary": "..." }
  ]
}
```

---

### `get_session_details`

Returns full detail for a session.

**Input:** `sessionId` (string, required)

**Return includes:** `status`, `llmFeedback`, `humanFeedback`, `escalationReason`, `iterationCount`, `reviewerType`

---

### `resolve_session`

Manually resolve a session. Used by the web UI and for testing.

**Input:** `sessionId` (string), `feedback` (string)

---

## Model Routing (optional)

The `select_model` tool picks the cheapest sufficient model before significant LLM calls.

### `select_model`

**Input:** `prompt` (string, required), `context` (string, optional)

**Return:**
```json
{ "model": "claude-sonnet-4", "cached": false, "latencyMs": 42 }
```

**How routing works:**
1. First 500 chars of the prompt are hashed for cache lookup (200-entry LRU).
2. On cache miss: the classifier (your local llama.cpp) picks from the live model list fetched from LiteLLM.
3. Selection tiers: local/small → fast cloud → frontier → reasoning models.
4. Any routing failure falls back silently to `router.fallbackModel`.

Requires a running LiteLLM proxy (`router.litellmBaseUrl`). Disable with `router.enabled: false`.

---

## Configuration

Create `pingpong.config.json` in your **project root** (not the pingpong install directory). Pingpong reads it from `process.cwd()` at startup — one config per project.

```json
{
  "llm": {
    "endpoint": "http://127.0.0.1:8080/v1/chat/completions",
    "model": "default",
    "temperature": 0.2,
    "maxTokens": 4096,
    "timeout": 1800
  },
  "prd": {
    "autoDetect": true,
    "paths": ["./docs/PRD.md", "./PRD.md", "./README.md"],
    "fallbackPath": null
  },
  "review": {
    "maxIterations": 5,
    "retryOnLlmError": true
  },
  "escalation": {
    "enabled": true,
    "port": 3458,
    "autoOpenBrowser": true
  },
  "gitDiff": {
    "enabled": true,
    "maxSizeBytes": 102400
  },
  "router": {
    "enabled": false,
    "litellmBaseUrl": "http://localhost:4000",
    "litellmApiKey": "sk-1234",
    "classifierUrl": "http://127.0.0.1:8080/v1/chat/completions",
    "fallbackModel": "best",
    "modelListRefreshSeconds": 60,
    "cacheMaxEntries": 200
  }
}
```

Copy `pingpong.config.example.json` as a starting point.

### Key options

| Option | Default | Description |
|---|---|---|
| `llm.endpoint` | `http://127.0.0.1:8080/v1/chat/completions` | llama.cpp endpoint for reviews |
| `llm.timeout` | `1800` | Seconds before LLM call times out |
| `review.maxIterations` | `5` | Max LLM passes before human escalation |
| `escalation.enabled` | `true` | Whether to start the web UI server |
| `escalation.port` | `3458` | Port for the web UI and HTTP API |
| `router.enabled` | `false` | Enable model routing (requires LiteLLM) |

### Environment variable overrides

```bash
PINGPONG_LLM_ENDPOINT          # Override llm.endpoint
PINGPONG_LLM_MODEL             # Override llm.model
PINGPONG_LLM_TIMEOUT           # Override llm.timeout (integer seconds)
PINGPONG_PRD_PATH              # Set prd.fallbackPath
PINGPONG_ESCALATION_PORT       # Override escalation.port
PINGPONG_ROUTER_ENABLED        # "true" or "false"
PINGPONG_ROUTER_FALLBACK_MODEL # Override router.fallbackModel
```

---

## Web UI & HTTP API

The escalation server starts automatically when `escalation.enabled` is true. If port `3458` is already in use (e.g. a prior instance), Pingpong logs a warning and continues without the web UI — stdio tool calls still work.

### Pages

| URL | Description |
|---|---|
| `http://localhost:3458/review-requests` | All review sessions — status, feedback, iteration count |
| `http://localhost:3458/` | Model routing dashboard (if router enabled) |

### HTTP API

```
GET  /api/health                    Health check
GET  /api/sessions                  All sessions with full fields
POST /api/sessions/:id/feedback     Submit human review feedback
DELETE /api/sessions/:id            Delete a session
GET  /api/routing-events            Recent routing decisions
```

Submit feedback:
```bash
curl -X POST http://localhost:3458/api/sessions/<sessionId>/feedback \
  -H 'Content-Type: application/json' \
  -d '{"feedback": "Approved — looks good."}'
```

`ok`, `lgtm`, `approved`, `looks good`, or `ship it` (case-insensitive) resolve the session as approved.

---

## Session Storage

Sessions persist to `.pingpong/sessions/` in your **project root** (the directory where the agent runs, not the pingpong install). Each session is a JSON file named by its nanoid. Sessions older than 24 hours are purged by an hourly cleanup cron.

Add `.pingpong/` to your project's `.gitignore`.

---

## Agent Contract

Two template files govern agent behavior after install:

**`~/.omp/agent/APPEND_SYSTEM.md`** — injected into the agent system prompt:
- Agent **must** call `request_review` after completing any task
- Agent must never claim work is done without an approved review
- `needs_revision` feedback is a directive to fix and re-submit in the same session

**`~/.omp/agent/LLAMACPP.md`** — context for the local LLM reviewer:
- Six evaluation categories and their criteria
- Required JSON response format
- Edit to adjust review strictness or add project-specific rules

---

## Development

### Build and deploy

```bash
npm run build              # Compile TypeScript to dist/
npm test                   # Run all tests
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only

# Deploy to local OMP skill installation
./scripts/sync-to-skill.sh
```

`sync-to-skill.sh` builds, then rsyncs `dist/` and `templates/` to `~/.omp/skills/pingpong/`. Restart OMP after running it.

### Project layout

```
src/
├── mcp.ts                 # MCP entry point — tool handlers, stdio transport
├── config.ts              # Config loader, env overrides, validation
├── types.ts               # All TypeScript types
├── review-loop.ts         # Review iteration orchestrator
├── llm-client.ts          # LLM HTTP client and response parser
├── llm-prompt.ts          # Prompt assembler
├── context-gatherer.ts    # PRD, git diff, AGENTS.md loading
├── session-manager.ts     # Session CRUD, file persistence, cleanup cron
├── escalation-server.ts   # Express HTTP server, all routes
├── router.ts              # ModelRouter, LiteLLM integration, route events
└── tools/
    └── mcp_pingpong_select_model.ts

templates/
├── APPEND_SYSTEM.md       # Agent system prompt additions
├── LLAMACPP.md            # Local LLM reviewer instructions
├── escalation.html        # Human review session page
├── review-requests.html   # Session dashboard
├── routing-dashboard.html # Routing events dashboard
└── setup.html             # llama.cpp setup guide

scripts/
└── sync-to-skill.sh       # Build + deploy to ~/.omp/skills/pingpong/
```

---

## Troubleshooting

**Sessions stay `pending` in the dashboard**
The MCP tool blocks and returns the final status — if you see `pending` it means an old session from a prior (broken) version. Delete stale sessions via the dashboard or `DELETE /api/sessions/:id`.

**llama.cpp not connecting**
```bash
curl http://127.0.0.1:8080/v1/models   # verify it is running
llama-server -p 8080 -m /path/to/model.gguf
```

**Port 3458 already in use**
A prior Pingpong process is still running. Kill it, or set a different `escalation.port` in config. Pingpong will log a warning and run without the web UI if the port is occupied.

**PRD not detected**
Ensure a file exists at `./docs/PRD.md`, `./PRD.md`, or `./README.md` in your project root, or set `prd.fallbackPath` in `pingpong.config.json`.

**Router always falls back**
LiteLLM is not running at `router.litellmBaseUrl`, or `router.enabled` is false. Check `router.litellmBaseUrl` in config.

**MCP not appearing in tool list after restart**
Verify `~/.omp/agent/mcp.json` points at `~/.omp/skills/pingpong/dist/mcp.js` and that file exists.

---

## License

MIT

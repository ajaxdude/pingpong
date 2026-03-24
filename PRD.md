# Pingpong PRD — Automated Code Review & Model Routing MCP

**Project:** Pingpong
**Version:** 1.1.0
**Date:** 2026-03-23
**Status:** Implemented

---

## Executive Summary

Pingpong is an MCP (Model Context Protocol) server that provides two integrated services:

1. **Automated code review** — a local LLM iteratively reviews code changes against the project PRD and structured criteria, with human escalation as a safety net.
2. **Intelligent model routing** — a lightweight router selects the most cost-effective LLM model for each task based on prompt content, caching repeated decisions.

Together these let an agent working inside a premium-request-metered harness (e.g. GitHub Copilot via oh-my-pi) close the full write-review-fix loop without spending additional premium tokens, and route non-review LLM calls to the cheapest sufficient model.

---

## Problem Statement

GitHub Copilot charges per premium request (300/month on Pro). Every follow-up prompt burns another request. Copilot-leecher converts follow-ups into free MCP tool results, but still requires a human reviewer for every task.

**Two compounding problems:**
1. Automated code review still requires human time for every iteration.
2. All LLM calls default to the most capable (most expensive) model even for trivial tasks.

**Pingpong solves both:**
- Automate the review loop with a local LLM, escalating to human only on failure or after exhausting iterations.
- Route each LLM request to the most cost-effective model via a LiteLLM proxy classifier.

---

## Key Differentiators

| Aspect | Copilot-Leecher | Pingpong |
|---|---|---|
| Reviewer | Human via web UI | Local LLM, human only on escalation |
| Review trigger | Every request | Every request |
| Escalation | N/A (always human) | After 5 LLM iterations or LLM error |
| Context | Summary only | Summary + PRD + git diff + LLAMACPP.md |
| Web UI | Always running | Always running (dashboard + escalation) |
| Model routing | None | LiteLLM-backed classifier with caching |

---

## Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│  Agent (oh-my-pi)                                           │
│  - Completes task                                           │
│  - Calls mcp_pingpong_request_review                        │
│  - Calls mcp_pingpong_select_model (before heavy LLM calls) │
└────────────────────────┬────────────────────────────────────┘
                         │ stdio (MCP)
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Pingpong MCP Server (src/mcp.ts)                           │
│                                                             │
│  Tools exposed:                                             │
│  - request_review       - get_session_list                  │
│  - get_session_details  - resolve_session                   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Review Loop (src/review-loop.ts)                   │   │
│  │  - Iterates up to maxIterations (default: 5)        │   │
│  │  - Gathers context per iteration                    │   │
│  │  - Routes to model via ModelRouter                  │   │
│  │  - Calls LLM, parses JSON response                  │   │
│  │  - Updates session state                            │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Context Gatherer (src/context-gatherer.ts)         │   │
│  │  - PRD: auto-detects from known paths               │   │
│  │  - Git diff: staged + unstaged (git diff HEAD)      │   │
│  │  - LLAMACPP.md: ~/.omp/agent/LLAMACPP.md            │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Model Router (src/router.ts)                       │   │
│  │  - Queries LiteLLM for model list                   │   │
│  │  - Classifies prompts via local LLM                 │   │
│  │  - SHA-256 prompt hash cache (200 entries)          │   │
│  │  - Records routing events + effectiveness           │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Session Manager (src/session-manager.ts)           │   │
│  │  - In-memory + filesystem (.pingpong/sessions/)     │   │
│  │  - Hourly cleanup (sessions > 24h old)              │   │
│  │  - Callback-based resolve for async human feedback  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Escalation Server (src/escalation-server.ts)               │
│  Express — always running on port 3456                      │
│                                                             │
│  GET  /                         Routing dashboard           │
│  GET  /review-requests          All review sessions UI      │
│  GET  /review/:sessionId        Session review + feedback   │
│  GET  /api/health               Health check (JSON)         │
│  GET  /api/sessions             Session list (JSON)         │
│  GET  /api/routing-events       Router history (JSON)       │
│  POST /api/sessions/:id/feedback  Submit human feedback     │
└─────────────────────────────────────────────────────────────┘
```

### Review Data Flow

**Automated review (normal path):**
```
Agent calls request_review(taskId, summary, details?, conversationHistory?)
  → Session created (.pingpong/sessions/<nanoid>.json), status: pending
  → Review loop starts (async, non-blocking)
    Per iteration:
      → Context gathered: PRD + git diff + LLAMACPP.md
      → Prompt assembled (src/llm-prompt.ts): PRD / diff / agent contract / task / history / criteria
      → ModelRouter selects optimal model (or falls back to default)
      → LLM called: POST /v1/chat/completions with JSON-response instruction
      → Response parsed: { "status": "approved"|"needs_revision"|"escalated", "feedback": "..." }
      → Routing event effectiveness updated
      → Session updated with feedback
      → If approved or escalated: loop exits
      → If needs_revision and iterations < maxIterations: loop continues
  → On completion: session resolved, feedback returned to agent via callback
```

**Escalation path (LLM error or connection failure):**
```
Any LLM error (ECONNREFUSED, timeout, unparseable response)
  → Session status set to: escalated
  → Escalation reason recorded: connection_failed | llm_error
  → If connection_failed: /review/:id shows llama.cpp setup guide
  → Otherwise: /review/:id shows session history + human feedback form
  → Human submits feedback via POST /api/sessions/:id/feedback
  → Callback fires, agent receives result
```

---

## Feature Specifications

### Feature 1: Automated Code Review

#### MCP Tool: `request_review`

**Input:**
```typescript
interface RequestReviewInput {
  taskId: string;                // Required. Format: [type]-[date]-[seq], e.g. feature-20260314-001
  summary: string;               // Required. 2–3 sentence description of what changed and why.
  details?: string;              // Optional. Additional context, assumptions, edge cases.
  conversationHistory?: string[]; // Optional. Array of conversation turns for context.
}
```

**Output (immediate — review is async):**
```typescript
interface RequestReviewResult {
  status: 'pending' | 'approved' | 'needs_revision' | 'escalated';
  feedback: string;
  sessionId: string;
  iterationCount: number;
  reviewerType: 'llm' | 'human';
}
```

**Behavior:**
- Returns immediately with `status: pending` and a `sessionId`.
- The review loop runs asynchronously; the session is resolved via callback once complete.
- Rate limited: 10 requests per minute per `taskId`.

#### Review Loop

- Iterates up to `review.maxIterations` (default: 5).
- On each pass: full context is re-gathered (PRD, git diff, LLAMACPP.md are read fresh each iteration, capturing any changes the agent made).
- LLM must return a JSON object. Any non-JSON or missing-field response is treated as a parse error and triggers escalation.
- Session history (prior iteration feedback) is accumulated and included in subsequent prompts so the LLM has full context.

#### Context Gathering (`src/context-gatherer.ts`)

| Source | Location | Behavior on Failure |
|---|---|---|
| PRD | `./docs/PRD.md`, `./PRD.md`, `./README.md` (first found) | Omitted; review proceeds without it |
| Git diff | `git diff HEAD` + `git diff --cached` | Empty string; review proceeds |
| LLAMACPP.md | `~/.omp/agent/LLAMACPP.md` | Omitted |

Files > 100KB are truncated with a warning appended. Each section in the assembled prompt is capped at 25KB.

#### LLM Request Format

```json
{
  "model": "<selected by router or configured default>",
  "messages": [
    {
      "role": "system",
      "content": "You are an expert code reviewer. Analyze the code changes and provide feedback. Respond ONLY with a JSON object containing \"status\" (approved|needs_revision|escalated) and \"feedback\" (your detailed analysis). Do not include any other text, markdown formatting, or explanations."
    },
    {
      "role": "user",
      "content": "<assembled prompt: PRD / git diff / LLAMACPP.md / task / session history / review criteria>"
    }
  ],
  "temperature": 0.2,
  "max_tokens": 4096
}
```

#### LLM Response Format

The LLM **must** return a JSON object. Pingpong extracts the first `{...}` block from the response:

```json
{
  "status": "approved",
  "feedback": "All changes are correct and well-structured."
}
```

```json
{
  "status": "needs_revision",
  "feedback": "1. No rate limiting on login endpoint. 2. JWT secret is hardcoded — must be env var."
}
```

```json
{
  "status": "escalated",
  "feedback": "Architecture decision required: should this be a microservice or a monolith?"
}
```

If no valid JSON is found or required fields are missing, Pingpong escalates to human review.

#### Built-in Review Criteria

Every prompt includes these six evaluation categories:

1. **Correctness** — compiles, logic matches PRD, edge cases handled, no obvious bugs.
2. **Code Quality** — idiomatic, clear naming, proper error handling, no dead code.
3. **Security** — no hardcoded secrets, input validation, no injection vulnerabilities, least privilege.
4. **Performance** — no anti-patterns, efficient algorithms, resource cleanup.
5. **Maintainability** — single responsibility, DRY, clear abstractions, comments for non-obvious logic.
6. **Documentation** — docstrings/JSDoc for public functions, API contracts clear.

---

### Feature 2: Model Routing

#### MCP Tool: `mcp_pingpong_select_model`

Exposed to agents so they can route their own non-review LLM calls to the most appropriate model.

**Input:**
```typescript
interface SelectModelInput {
  prompt: string;    // The task prompt or description.
  context?: string;  // Optional extra context prepended before routing.
}
```

**Output:**
```typescript
interface SelectModelOutput {
  model: string;     // Model ID to use for this prompt.
  cached: boolean;   // Whether this was served from cache.
  latencyMs: number; // Router latency in milliseconds.
}
```

#### ModelRouter (`src/router.ts`)

The router operates on a singleton `modelRouter` instance.

**Model selection algorithm:**
1. Hash the first 500 chars of the prompt with SHA-256.
2. Check the in-memory cache (`Map<hash, modelId>`, max 200 entries).
3. On cache miss: call the classifier LLM (default: same llama.cpp endpoint) with the prompt and the live model list from LiteLLM. The classifier responds with a single model ID.
4. Validate the returned ID against the live model list. If invalid, fall back to `router.fallbackModel`.
5. On any error (classifier unreachable, LiteLLM unreachable): fall back silently.

**Classifier routing heuristics (in system prompt):**
- Local/small models: simple edits, one-liners, boilerplate, completions, renaming, formatting.
- Fast cloud models (gemini-flash, haiku, grok-fast): moderate refactoring, bug fixes, single-file changes.
- Large frontier models (qwen3-coder-480b, claude-sonnet, gemini-pro): architecture, complex bugs, multi-file reasoning.
- Thinking/reasoning models: deep planning, algorithm design, security analysis.

**Model list refresh:**
The router periodically fetches the available model list from LiteLLM (`GET /v1/models`). Interval is configurable via `router.modelListRefreshSeconds` (default: 60s). A stale or empty list does not block routing — the fallback model is used.

**Route event tracking:**
Every routing decision is appended to an in-memory circular buffer (500 events):

```typescript
interface RouteEvent {
  id: string;
  timestamp: string;           // ISO-8601
  promptExcerpt: string;       // First 200 chars of prompt
  selectedModel: string;
  latencyMs: number;
  cached: boolean;
  fallback: boolean;           // True when router fell back to fallbackModel
  effectiveness: 'approved' | 'needs_revision' | 'escalated' | 'unknown';
}
```

After each review loop completes, the effectiveness field of the associated routing event is updated to reflect the review outcome. This lets the routing dashboard show whether model selections are working.

---

### Feature 3: Session Management

Sessions persist to `.pingpong/sessions/<nanoid>.json` in the project root (created automatically). In-memory state is authoritative; disk is for durability across restarts.

**Session structure:**
```typescript
interface ReviewSession {
  id: string;                        // nanoid
  taskId: string;
  status: 'pending' | 'approved' | 'needs_revision' | 'escalated';
  summary: string;
  details?: string;
  conversationHistory?: string[];
  llmFeedback?: string;              // Last feedback from LLM
  humanFeedback?: string;            // Feedback from human (if escalated)
  escalationReason?: 'max_iterations' | 'llm_error' | 'connection_failed';
  iterationCount: number;
  reviewerType?: 'llm' | 'human';
  agentResolve?: (result) => void;   // In-memory only; not serialized
  createdAt: string;                 // ISO-8601
  updatedAt: string;                 // ISO-8601
}
```

**Cleanup:** Sessions older than 24 hours are deleted on an hourly cron (`startCleanupCron`).

---

### Feature 4: Escalation Server & Web UI

The escalation server (Express) starts unconditionally when `escalation.enabled` is true (default). It serves both routine monitoring dashboards and the human-review escalation flow.

#### Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Routing dashboard — live routing events, model effectiveness |
| `GET` | `/review-requests` | Review requests dashboard — all sessions |
| `GET` | `/review/:sessionId` | Session detail page — LLM feedback, human feedback form |
| `GET` | `/api/health` | JSON health check `{ status, timestamp, server }` |
| `GET` | `/api/sessions` | JSON list of all sessions with full fields |
| `GET` | `/api/routing-events` | JSON list of routing events (newest first) |
| `POST` | `/api/sessions/:id/feedback` | Submit human feedback; fires agent resolve callback |

#### Connection Failure Page

When a session has `escalationReason: connection_failed`, `/review/:sessionId` renders `templates/setup.html` — an installation guide for llama.cpp with the configured endpoint URL injected. This lets users self-serve without checking logs.

#### Feedback Validation

`POST /api/sessions/:id/feedback` requires a non-empty `feedback` string. Returns `400` on missing/empty feedback, `404` on unknown session, `503` if session manager is unavailable.

---

### Feature 5: Rate Limiting

The MCP `request_review` handler enforces a sliding-window rate limit:
- **Limit:** 10 requests per minute per `taskId`.
- **Window:** last 60 seconds.
- **Cleanup:** timestamps older than 5 minutes are evicted from the tracking map.
- **Behavior on breach:** throws `Error('Rate limit exceeded. Please try again later.')`.

---

## Configuration

### `pingpong.config.json`

Place in the project root. Deep-merged with defaults; missing keys fall back to defaults. Invalid values produce a warning and fall back to the default silently.

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
    "port": 3456,
    "autoOpenBrowser": true
  },
  "gitDiff": {
    "enabled": true,
    "maxSizeBytes": 102400
  },
  "router": {
    "enabled": true,
    "litellmBaseUrl": "http://localhost:4000",
    "litellmApiKey": "sk-1234",
    "classifierUrl": "http://127.0.0.1:8080/v1/chat/completions",
    "fallbackModel": "best",
    "modelListRefreshSeconds": 60,
    "cacheMaxEntries": 200
  }
}
```

### Config Validation Rules

| Field | Constraint | Fallback |
|---|---|---|
| `llm.timeout` | `> 0` | 1800 |
| `llm.endpoint` | Valid URL | `http://127.0.0.1:8080/v1/chat/completions` |
| `escalation.port` | 1024–65535 | 3456 |
| `review.maxIterations` | `>= 1` | 5 |

### Environment Variable Overrides

| Variable | Config key overridden |
|---|---|
| `PINGPONG_LLM_ENDPOINT` | `llm.endpoint` (validated as URL) |
| `PINGPONG_LLM_MODEL` | `llm.model` |
| `PINGPONG_LLM_TIMEOUT` | `llm.timeout` (parsed as int) |
| `PINGPONG_PRD_PATH` | `prd.fallbackPath` |
| `PINGPONG_ESCALATION_PORT` | `escalation.port` (validated 1024–65535) |
| `PINGPONG_ROUTER_ENABLED` | `router.enabled` (true/false string) |
| `PINGPONG_ROUTER_FALLBACK_MODEL` | `router.fallbackModel` |

---

## MCP Tools Reference

Pingpong exposes four tools via MCP:

### `request_review`

Submit completed work for review. Returns immediately with `status: pending`; the review loop runs asynchronously.

```typescript
// Input
{ taskId: string; summary: string; details?: string; conversationHistory?: string[] }

// Output
{ status: ReviewStatus; feedback: string; sessionId: string; iterationCount: number; reviewerType: ReviewerType }
```

### `get_session_list`

Returns a flat list of all sessions (id, taskId, status, summary).

```typescript
// Output
{ sessions: Array<{ id: string; taskId: string; status: string; summary: string }> }
```

### `get_session_details`

Returns full session data for a given `sessionId`.

```typescript
// Input
{ sessionId: string }

// Output (all nullable fields may be absent)
{ id, taskId, status, summary, details?, llmFeedback?, humanFeedback?, escalationReason?, iterationCount, reviewerType? }
```

### `resolve_session`

Manually resolve a session with provided feedback. Fires the agent callback.

```typescript
// Input
{ sessionId: string; feedback: string }

// Output
{ success: true }
```

---

## Project Structure

```
pingpong/
├── src/
│   ├── mcp.ts                  # MCP server entry point (bin: pingpong)
│   ├── index.ts                # Alternative entry with graceful shutdown
│   ├── mcp-server.ts           # Server setup, tool handlers, rate limiting
│   ├── config.ts               # Config loader, deep merge, env overrides, validation
│   ├── types.ts                # All TypeScript types and interfaces
│   ├── review-loop.ts          # Review orchestrator; LLM iteration logic
│   ├── llm-client.ts           # axios HTTP client for llama.cpp; response parser
│   ├── llm-prompt.ts           # Prompt assembler (PRD/diff/LLAMACPP/task/history/criteria)
│   ├── context-gatherer.ts     # PRD detection, git diff execution, LLAMACPP.md loading
│   ├── session-manager.ts      # Session CRUD, filesystem persistence, cleanup cron
│   ├── escalation-server.ts    # Express server; all HTTP routes; template rendering
│   ├── router.ts               # ModelRouter; LiteLLM integration; route event buffer
│   ├── http.ts                 # Shared axios instance
│   └── tools/
│       └── mcp_pingpong_select_model.ts  # Tool handler for model selection
├── templates/
│   ├── APPEND_SYSTEM.md        # Agent instructions: review loop + model routing
│   ├── LLAMACPP.md             # Local LLM reviewer instructions
│   ├── escalation.html         # Session review + human feedback form
│   ├── review-requests.html    # All sessions dashboard
│   ├── routing-dashboard.html  # Routing events dashboard
│   └── setup.html              # llama.cpp setup guide (shown on connection failure)
├── tests/
│   ├── unit/                   # Unit tests (vitest)
│   └── integration/            # Integration tests
├── dist/                       # Compiled output (gitignored)
├── .pingpong/sessions/         # Session files (gitignored)
├── package.json
├── tsconfig.json
├── pingpong.config.example.json
└── install.sh                  # oh-my-pi installer
```

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4",  // MCP server and stdio transport
    "axios": "^1.6.0",                        // LLM HTTP client
    "express": "^4.18.0",                     // Escalation web server
    "nanoid": "^5.0.0"                        // Session ID generation
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

---

## Error Handling

| Error Scenario | Detection | Handling |
|---|---|---|
| PRD not found | No file at any configured path | Omit PRD section; review continues |
| Not a git repository | `git rev-parse` fails | Empty diff; review continues |
| No git changes | `git diff HEAD` returns empty | Omit diff section; review continues |
| LLM timeout | axios timeout after `llm.timeout` seconds | Escalate: `reason: llm_error` |
| LLM connection refused | `ECONNREFUSED` / `ENOTFOUND` / `ECONNRESET` | Escalate: `reason: connection_failed` |
| LLM API error (4xx/5xx) | axios response with error status | Escalate: `reason: llm_error` |
| Unparseable LLM response | No valid JSON `{ status, feedback }` | Escalate: `reason: llm_error` |
| Max iterations reached | `iterationCount >= maxIterations` | Escalate: `reason: max_iterations` |
| Session not found | `sessionManager.getSession` returns null | Tool call returns null |
| Session manager unavailable | Initialization failure | Tool calls return empty/null gracefully |
| Router classifier failure | Any error from classifier | Fall back to default model; never block review |
| LiteLLM model list unavailable | Fetch error | Use last known list; no crash |
| Rate limit exceeded | >10 requests/min per taskId | Throw error with retry message |

---

## Logging

Pingpong writes structured logs to stderr (standard for MCP processes):

```
[INFO]  Session created: taskId=feature-20260314-001 sessionId=abc123
[INFO]  Router selected model: claude-sonnet-4 (cached: false, latency: 42ms)
[INFO]  Calling LLM — iteration 1/5
[INFO]  LLM response: status=needs_revision
[INFO]  Iteration 2/5
[INFO]  LLM response: status=approved
[WARN]  PRD not found, checked: ./docs/PRD.md, ./PRD.md, ./README.md
[WARN]  Model router failed, using default model: ECONNREFUSED
[ERROR] LLM connection refused: http://127.0.0.1:8080
[ERROR] Failed to parse LLM response: no valid JSON found
```

---

## Security Considerations

- **Local-only communication:** Both the LLM endpoint (default: 127.0.0.1:8080) and the escalation server (default: 127.0.0.1:3456) bind to localhost only. No external network exposure.
- **No authentication required:** Both endpoints are local and assumed trusted. Do not expose them externally.
- **Session storage:** Sessions are written to `.pingpong/sessions/` in the project root. This directory contains task summaries, git diffs, and LLM feedback — treat it as sensitive if working with proprietary code.
- **Input validation:** `taskId` and `feedback` fields are validated for presence. Feedback is trimmed. Endpoint URLs are validated via `new URL()` before use.
- **No secrets in config:** `router.litellmApiKey` is a LiteLLM proxy key — treat it as a secret and do not commit `pingpong.config.json` if it contains real keys.
- **Git diff content:** The full diff of the working tree is sent to the local LLM. If `llm.endpoint` is pointed at an external service, code content will be transmitted. Default is local only.
- **LLM output sanitization:** LLM responses are parsed as JSON with field type validation. String values are not executed or rendered as HTML — they are transmitted back to the agent as text.

---

## Performance Considerations

- **LLM timeout:** Default 1800s (30 minutes). Reviewable via `PINGPONG_LLM_TIMEOUT`. Set lower if your LLM is fast; raise it for large codebases.
- **Git diff truncation:** Diffs > 100KB are truncated. Prompt sections are capped at 25KB. Reviews of very large changesets will lose context but will not OOM.
- **Router cache:** SHA-256 hash of first 500 prompt chars → model ID. Cache prevents classifier roundtrips for repeated prompt patterns (e.g. boilerplate commits). `cacheMaxEntries` defaults to 200 (LRU eviction via Map ordering is not implemented — cache grows up to 200 before being ignored).
- **Session cleanup:** Sessions older than 24h are deleted on an hourly cron. On long-running servers this prevents unbounded disk growth.
- **Concurrency:** Multiple agents can submit concurrent reviews; each gets its own session and async review loop. No shared mutable state between sessions.

---

## Agent Integration

### `templates/APPEND_SYSTEM.md`

Installed at `~/.omp/agent/APPEND_SYSTEM.md`. Injects two behaviors into the agent system prompt:

1. **Review loop:** Agent must call `mcp_pingpong_request_review` after completing any task. Never finish without an approved review.
2. **Model routing:** Before significant LLM calls, agent should call `mcp_pingpong_select_model` with the task prompt and use the returned model ID.

### `templates/LLAMACPP.md`

Installed at `~/.omp/agent/LLAMACPP.md`. Loaded by Pingpong as additional context when building review prompts. Contains the local LLM's reviewer instructions, evaluation framework, and response format requirements. Edit this file to customize review behavior without changing Pingpong's source.

---

## Testing Strategy

### Unit Tests (`tests/unit/`)

- **Config:** defaults, deep merge, env overrides, validation rules
- **PRD locator:** path priority, missing file, truncation
- **Git diff:** normal output, no repo, no changes, large diff truncation
- **LLM client:** request construction, JSON parsing, error type classification
- **Session manager:** CRUD, iteration tracking, cleanup, callback dispatch
- **Review loop:** approved/needs_revision paths, max iterations, LLM error handling, router integration
- **Router:** model selection, cache hits, fallback on error, route event recording

### Integration Tests (`tests/integration/`)

- Full review cycle with mock llama.cpp server
- Escalation on max iterations
- Escalation on LLM connection failure
- Human feedback submission via HTTP API
- Multi-session concurrency

### Coverage Target

80%+ line coverage on all files in `src/`. All error paths must be covered.

---

## Installation

### oh-my-pi Users

```bash
curl -sSL https://raw.githubusercontent.com/ajaxdude/pingpong/master/install.sh | bash
```

Installs to `~/.omp/skills/pingpong/` and updates:
- `~/.omp/agent/APPEND_SYSTEM.md` — agent review loop + routing instructions
- `~/.omp/agent/LLAMACPP.md` — local LLM reviewer instructions
- `~/.omp/agent/mcp.json` — registers the Pingpong MCP server

### Manual

```bash
git clone https://github.com/ajaxdude/pingpong.git
cd pingpong
npm install && npm run build
cp pingpong.config.example.json pingpong.config.json
# Edit pingpong.config.json with your LLM endpoint and LiteLLM proxy URL
```

Add to your MCP server list (oh-my-pi or any MCP-compatible harness):
```json
{
  "mcpServers": {
    "pingpong": {
      "command": "node",
      "args": ["/path/to/pingpong/dist/mcp.js"]
    }
  }
}
```

### Verification

```bash
# Confirm llama.cpp is running
curl http://127.0.0.1:8080/v1/models

# Confirm escalation server is up
curl http://localhost:3456/api/health

# Confirm session directory exists
ls .pingpong/sessions/

# Run tests
npm test
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot connect to LLM endpoint` | llama.cpp not running | `llama-server -p 8080 -m path/to/model.gguf` |
| PRD not included in review | No PRD at detected paths | Set `prd.fallbackPath` in config or create `./PRD.md` |
| Setup page appears in browser | `connection_failed` escalation | llama.cpp is not running or wrong endpoint |
| `Rate limit exceeded` | >10 calls/min from same taskId | Reduce call frequency or increase the limit in `mcp-server.ts` |
| Sessions not persisting | `.pingpong/sessions/` not writable | Check directory permissions |
| Router always falls back | LiteLLM not running | Start LiteLLM or set `router.enabled: false` |
| MCP server won't connect | `dist/mcp.js` missing | Run `npm run build` |
| TypeScript errors | Dependency mismatch | Run `npm install && npx tsc --noEmit` |

---

## Future Enhancements

- Custom review criteria per project (via config or `.pingpong/criteria.md`)
- Multi-PRD support for monorepos
- CI/CD integration (GitHub Actions webhook trigger)
- Review analytics (approval rate, average iterations, per-model effectiveness)
- Configurable review strictness levels
- LiteLLM router: weighted model selection based on historical effectiveness
- Parallel review (multiple LLMs, consensus voting)
- Review templates by language/framework

---

## Open Questions

None. Design is implemented and running.

---

**End of PRD**

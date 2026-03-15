# Pingpong PRD - Automated Code Review MCP

**Project:** Pingpong
**Version:** 1.0.0
**Date:** 2026-03-14
**Status:** Design Approved

## Executive Summary

Pingpong is an MCP (Model Context Protocol) server that provides automated code review using a local LLM instead of human review. Inspired by copilot-leecher, pingpong replaces the human-in-the-loop with an automated review system powered by llama.cpp, enabling agents to iterate on work within a single premium request while maintaining thorough code quality standards.

### Key Differentiators from Copilot-Leecher

| Aspect | Copilot-Leecher | Pingpong |
|---|---|---|
| Reviewer | Human via web UI | Local LLM (llama.cpp) |
| Review Trigger | Every request | Every request |
| Escalation | N/A (always human) | After 5 completed iterations (escalates on 6th call) or LLM error
| Context | Summary only | Summary + PRD + git diff + conversation history |
| Web UI | Always running (port 3456) | Only during escalation |

## Problem Statement

GitHub Copilot charges by premium requests (300/month on Pro), not by tokens. Follow-up prompts consume additional requests. While copilot-leecher solves this by converting follow-ups into free MCP tool calls with human review, this still requires human intervention for every task.

**Opportunity:** Automate the review process using a local LLM while maintaining:
- Comprehensive code quality standards
- Alignment with project requirements (PRD)
- Human oversight as a safety net (escalation after failures)

## Solution Overview

Pingpong provides an MCP tool `request_review` that:
1. Captures task context (summary, optional details, conversation history)
2. Automatically reads project state (PRD, git diff)
3. Sends comprehensive context to local LLM (llama.cpp on port 8080)
4. Receives structured feedback (STATUS: approved/needs_revision)
5. Returns feedback to agent for iteration
6. Escalates to human after 5 completed iterations (on the 6th request_review call) or on LLM errors

### Benefits

- **Zero premium request cost for iterations:** All review loops happen via MCP tool results
- **Thorough reviews:** Local LLM evaluates against PRD + strict criteria
- **Human oversight:** Escalation to web UI when automation fails
- **Comprehensive context:** Auto-reads PRD and code changes
- **Configurable:** Adapt to different workflows and requirements

## Architecture

### System Components

```
┌─────────────────┐
│  Agent (OMP)    │
│  - Completes    │
│    task         │
└────────┬────────┘
         │ MCP: request_review(taskId, summary, details?, conversationHistory?)
         ▼
┌─────────────────────────────────────────────────────────┐
│                   Pingpong MCP Server                    │
│  ┌───────────────────────────────────────────────────┐  │
│  │  1. Session Manager                               │  │
│  │     - Creates session in /tmp/pingpong-sessions/  │  │
│  │     - Tracks iteration count                      │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  2. Context Gatherers                             │  │
│  │     - PRD Locator: Auto-detects PRD               │  │
│  │     - Git Diff Reader: Reads git diff HEAD        │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  3. LLM Client                                    │  │
│  │     - Builds review prompt                        │  │
│  │     - Calls llama.cpp:8080                        │  │
│  │     - Parses STATUS: response                     │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  4. Review Loop Controller                        │  │
│  │     - Checks iteration limit (5)                  │  │
│  │     - Handles LLM errors (retry once)             │  │
│  │     - Escalates to human when needed              │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
         │
         │ (If escalation needed)
         ▼
┌─────────────────────────────────────────────────────────┐
│            Escalation Server (Express)                  │
│            - Web UI at localhost:3456                   │
│            - Auto-opens browser                         │
│            - Human provides feedback                    │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

**Normal Flow (Automated Review):**
```
Agent → request_review(taskId, summary, details?, conversationHistory?)
  → Pingpong creates session
  → PRD locator finds project PRD
  → Git diff reader reads git diff HEAD
  → LLM client builds prompt:
    - Task summary
    - PRD content
    - Git diff
    - Conversation history (if provided)
    - Built-in review criteria (correctness, quality, security, performance, maintainability, documentation)
  → Calls llama.cpp:8080/v1/chat/completions
  → Parses response: "STATUS: approved/needs_revision" + feedback
  → If approved: Returns success to agent
  → If needs_revision: Returns feedback, agent improves, retries
  → (Loop up to 5 iterations)
```

**Escalation Flow:**
```
Agent → request_review (6th iteration OR LLM error after retry)
  → Pingpong starts escalation server on port 3456
  → Auto-opens browser to localhost:3456?session=<id>
  → Human reviews session history and feedback
  → Human submits feedback via web UI
  → Feedback returned to agent as tool result
  → Agent improves and calls request_review again
```

## Technical Specifications

### MCP Tool: request_review

**Input Schema:**
```typescript
interface RequestReviewInput {
  taskId: string;                  // Required: Unique task identifier
  summary: string;                 // Required: 2-3 sentence summary
  details?: string;                // Optional: Additional context
  conversationHistory?: string;    // Optional: Full conversation for context
}
```

**Output Schema:**
```typescript
interface RequestReviewResult {
  status: 'approved' | 'needs_revision';
  feedback: string;
  sessionId: string;
  iterationCount: number;
  reviewerType: 'llm' | 'human';
}
```

### Configuration: pingpong.config.json

Created in project root during setup:

```json
{
  "llm": {
    "endpoint": "http://127.0.0.1:8080/v1/chat/completions",
    "model": "default",
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
    "port": 3456,
    "autoOpenBrowser": true
  }
}
```

**Environment Variable Overrides:**
- `PINGPONG_LLM_ENDPOINT` - Override LLM endpoint
- `PINGPONG_LLM_MODEL` - Override model name
- `PINGPONG_LLM_TIMEOUT` - Override timeout (seconds)
- `PINGPONG_PRD_PATH` - Override PRD path

### HTTP API (Monitoring)

Available when escalation server is running:

- `GET /api/sessions` - List all sessions
- `GET /api/sessions/pending` - List pending sessions
- `GET /api/sessions/:id` - Get session details
- `GET /api/health` - Health check

## Built-in Review Criteria

The local LLM evaluates code against these comprehensive criteria:

### 1. Correctness
- Code compiles/runs without errors
- Logic matches requirements in PRD
- No obvious bugs or logic errors
- Edge cases are handled

### 2. Code Quality
- Follows language idioms and best practices
- Clear naming (variables, functions, classes)
- Proper error handling
- No dead code or commented-out code
- Appropriate use of data structures and algorithms

### 3. Security
- No hardcoded secrets or credentials
- Input validation and sanitization
- Proper use of secure APIs
- No SQL injection, XSS, or similar vulnerabilities
- Least privilege principles

### 4. Performance
- No obvious performance anti-patterns
- Efficient algorithms for data scale
- No unnecessary expensive operations in loops
- Resource cleanup (connections, file handles, memory)

### 5. Maintainability
- Single responsibility per function/module
- DRY principle (don't repeat yourself)
- Clear separation of concerns
- Appropriate abstraction level
- Comments for non-obvious logic

### 6. Documentation
- Public functions have docstrings/JSDoc
- Complex logic is explained
- API contracts are clear
- Usage examples if appropriate

## Local LLM Integration

### LLM Request Format

```json
{
  "model": "default",
  "messages": [
    {
      "role": "system",
      "content": "<Built-in review criteria from AGENTS.md>"
    },
    {
      "role": "user",
      "content": "<Review request with task summary, PRD, git diff, conversation history>"
    }
  ],
  "temperature": 0.3,
  "max_tokens": 2000
}
```

### LLM Response Format

The local LLM MUST respond with one of these formats:

**Approved:**
```
STATUS: approved
<optional feedback or praise>
```

**Needs Revision:**
```
STATUS: needs_revision
<specific, actionable feedback on what to fix>
```

### Error Handling

| Error Type | Handling |
|---|---|
| Connection timeout (1800s default) | Retry once, then escalate to human |
| Connection refused | Retry once, then escalate to human |
| Invalid response (no STATUS:) | Log error, escalate to human |
| Parse error | Log error, escalate to human |

## Agent Contract

Pingpong provides `APPEND_SYSTEM.md` template for installation at `~/.omp/agent/APPEND_SYSTEM.md`:

```markdown
### 3. Review loop via pingpong

After completing all work, you MUST call the `request_review` tool:
- `taskId`: format `[type]-[date]-[seq]` — e.g. `feature-20260314-001`, `fix-20260314-001`, `refactor-20260314-001`
- `summary`: 2–3 sentences covering what changed, why, and any assumptions made
- `conversationHistory` (optional): Include full conversation if it provides important context
- `details` (optional): Any additional technical context

**What pingpong reviews:**
- Your task summary and details
- Project PRD (auto-detected from `./docs/PRD.md`, `./PRD.md`, or `./README.md`)
- Git diff (auto-read: unstaged + staged changes via `git diff HEAD`)
- Conversation history (if provided)
- Built-in comprehensive criteria: correctness, quality, security, performance, maintainability, documentation

**How automated review works:**
Pingpong sends your work to a local LLM (llama.cpp:8080) for thorough evaluation. The local LLM responds with:
- `STATUS: approved` → stop immediately, confirm completion
- `STATUS: needs_revision` → read the feedback, improve your work, call `request_review` again

**Escalation to human (after 5 iterations or LLM errors):**
- Web UI opens at `http://127.0.0.1:3456` with full session history
- Human reviews and provides feedback
- `"ok"` / `"approved"` / `"lgtm"` → task complete
- Any other feedback → improve and call `request_review` again

**Hard rules:**
- NEVER finish a task without an approved review
- NEVER skip the review step even if the change seems trivial
- Do not open a new prompt to handle feedback — all iteration stays in the same session
- If no PRD is detected, verify `pingpong.config.json` is configured correctly

**Review iteration:**
- Automated: Up to 5 iterations with local LLM
- After 5: Escalates to human via web UI
- Continue improving until approved (by LLM or human)
```

## Local LLM System Prompt

Pingpong provides `AGENTS.md` for local LLM context (installed at `~/.omp/agent/AGENTS.md`):

```markdown
# Pingpong Local LLM Review Instructions

You are an expert code reviewer. Your task is to evaluate the agent's work against the project PRD and comprehensive review criteria.

## Review Process

1. **Read the provided context:**
   - Task summary: what the agent did
   - Project PRD: requirements and specifications
   - Git diff: actual code changes
   - Conversation history: context and decisions
   - Built-in review criteria: your evaluation framework

2. **Evaluate systematically:**
   - Correctness: Does it work? Edge cases handled?
   - Code Quality: Idiomatic, clear, maintainable?
   - Security: No vulnerabilities, proper validation?
   - Performance: Efficient, no obvious anti-patterns?
   - Maintainability: Single responsibility, DRY, clear abstractions?
   - Documentation: Docstrings, comments for non-obvious logic?

3. **Check PRD alignment:**
   - Does the implementation match requirements?
   - Are all acceptance criteria met?
   - Any missing features or behaviors?

4. **Provide feedback:**
   - If approved: Output exactly `STATUS: approved` followed by optional praise
   - If needs revision: Output exactly `STATUS: needs_revision` followed by specific, actionable feedback
   - Be specific: what to fix, why it matters, how to fix it
   - Prioritize: critical issues first, minor improvements last

## Response Format

You MUST start your response with either:
```
STATUS: approved
<optional feedback>
```
OR
```
STATUS: needs_revision
<specific feedback on what to fix>
```

## Review Standards

- Be thorough but fair
- Explain why something is wrong, not just that it's wrong
- Suggest concrete improvements
- Recognize good work when you see it
- Consider the agent's constraints (single request, iteration limits)
```

## Implementation

### Project Structure

```
pingpong/
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── config.ts                # Config loader with defaults
│   ├── llm-client.ts            # llama.cpp communication
│   ├── git-diff.ts              # Git diff reader
│   ├── prd-locator.ts           # PRD auto-detection
│   ├── session-manager.ts       # Session persistence (/tmp/)
│   ├── escalation-server.ts     # Express web UI (conditional)
│   ├── review-prompt.ts         # Built-in review criteria builder
│   └── types.ts                 # TypeScript definitions
├── templates/
│   ├── APPEND_SYSTEM.md         # Agent contract template
│   └── AGENTS.md                # Local LLM prompt template
├── tests/
│   ├── unit/                    # Unit tests
│   └── integration/             # Integration tests
├── package.json
├── tsconfig.json
├── README.md                    # Installation instructions
└── pingpong.config.example.json # Config template
```

### Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "express": "^4.18.0",
    "axios": "^1.6.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

### Implementation Phases

1. **Phase 1: Core MCP Server**
   - Basic MCP server setup
   - `request_review` tool implementation
   - Session manager (create, read, update, delete)
   - Config loader with defaults

2. **Phase 2: Context Gathering**
   - PRD locator (auto-detect from paths)
   - Git diff reader (git diff HEAD)
   - Error handling for missing PRD/git repo

3. **Phase 3: LLM Integration**
   - LLM client (HTTP communication with llama.cpp)
   - Review prompt builder (assembles all context)
   - Response parser (STATUS: approved/needs_revision)

4. **Phase 4: Review Loop Logic**
   - Iteration tracking
   - Max iterations check (5)
   - Error handling with retry

5. **Phase 5: Escalation Server**
   - Express web UI (copilot-leecher style)
   - Auto-open browser
   - Human feedback form

6. **Phase 6: HTTP API**
   - Session listing endpoints
   - Health check

7. **Phase 7: Testing**
   - Unit tests (80%+ coverage)
   - Integration tests (mock llama.cpp)
   - Manual testing with real LLM

8. **Phase 8: Setup Automation**
   - README with LLM-installable instructions
   - Template file installation
   - Config file generation

## Testing Strategy

### Unit Tests

- **Config Loader:** Test default values, file reading, env var overrides
- **PRD Locator:** Test auto-detection logic, fallback paths
- **Git Diff Reader:** Test git commands, error handling (no repo, no changes)
- **LLM Client:** Test request formatting, response parsing, timeout handling
- **Session Manager:** Test CRUD operations, cleanup logic

### Integration Tests

- **End-to-End Review Flow:** Mock llama.cpp server, test full cycle
- **Escalation Flow:** Test max iterations, web UI startup, human feedback
- **Error Scenarios:** LLM down, timeout, invalid response

### Manual Testing

- Real llama.cpp instance with actual code reviews
- Verify PRD detection in various project structures
- Test escalation UI with real browser
- Verify session persistence and cleanup

### Coverage Goal

- 80%+ code coverage for core logic
- All error paths tested
- Edge cases covered (no PRD, no git repo, etc.)

## Installation & Setup

### User Installation

The README.md will contain LLM-installable instructions:

```markdown
## Installation

Copy the text below and paste it into your oh-my-pi (OMP) harness. The LLM will:

1. Clone the pingpong repository
2. Install dependencies (npm install, npm run build)
3. Create `pingpong.config.json` with detected defaults
4. Install `APPEND_SYSTEM.md` at `~/.omp/agent/` (merge or replace existing)
5. Install `AGENTS.md` at `~/.omp/agent/`
6. Configure the MCP server in OMP settings
7. Verify the setup (health check)

---

### Installation Instructions for OMP

1. Clone pingpong: `git clone https://github.com/yourusername/pingpong.git ~/ai/projects/pingpong`
2. Navigate to project: `cd ~/ai/projects/pingpong`
3. Install dependencies: `npm install`
4. Build project: `npm run build`
5. Create config: `cp pingpong.config.example.json pingpong.config.json`
6. Edit config if needed (default: llama.cpp at http://127.0.0.1:8080)
7. Install agent contract:
   - Check if `~/.omp/agent/APPEND_SYSTEM.md` exists
   - If yes, ask user: "Merge with existing APPEND_SYSTEM.md or replace?"
   - If merge: Append section 3 (Review loop via pingpong)
   - If replace or no file: Create full APPEND_SYSTEM.md with pingpong section
8. Install LLM prompt: `cp templates/AGENTS.md ~/.omp/agent/AGENTS.md`
9. Configure MCP in OMP settings (add to MCP servers list)
10. Verify: Restart OMP, check MCP server connects
11. Test: Run a simple task that calls request_review

### Verification

After installation, verify:
- Pingpong MCP server appears in OMP MCP list
- LLM is running: `curl http://127.0.0.1:8080/health`
- Test review: Agent should call request_review successfully
- Check logs: Pingpong should log "Review session created", "Calling LLM", etc.

### Troubleshooting

**MCP Server won't connect:**
- Verify `dist/index.js` exists (run `npm run build`)
- Check absolute path in OMP MCP settings
- Review OMP output panel → MCP Server logs

**LLM connection fails:**
- Verify llama.cpp is running: `curl http://127.0.0.1:8080/health`
- Check endpoint in `pingpong.config.json`
- Verify port 8080 is not in use by another service

**PRD not detected:**
- Check `pingpong.config.json` prd.paths
- Verify PRD file exists at one of the paths
- Set prd.fallbackPath to explicit path

**Git diff fails:**
- Verify project is a git repository
- Check git permissions
- Pingpong will log warning and continue without diff
```

## Error Handling

### Error Scenarios

| Scenario | Detection | Handling |
|---|---|---|
| PRD not found | PRD locator returns null | Log warning, continue without PRD |
| Not a git repo | Git command fails | Log warning, continue without diff |
| No git changes | Git diff empty | Log info, continue without diff |
| LLM timeout (1800s) | Axios timeout | Retry once, then escalate |
| LLM connection refused | Axios ECONNREFUSED | Retry once, then escalate |
| Invalid LLM response | No STATUS: prefix | Log error, escalate to human |
| Max iterations (5) | Counter reaches limit | Start escalation server |
| Session missing | Session ID not found | Return error to agent |

### Escalation to Human

When escalation occurs:
1. Start Express server on port 3456
2. Auto-open browser to `http://127.0.0.1:3456?session=<id>`
3. Display session history (summary, feedback loop, git diff summary)
4. Human provides feedback via web form
5. Submit feedback to session
6. Resolve agent's request_review call with feedback
7. Agent continues work

**Escalation Web UI Structure:**

The web UI should display (similar to copilot-leecher):

```html
<!DOCTYPE html>
<html>
<head><title>Pingpong Review - {sessionId}</title></head>
<body>
  <div class="container">
    <h1>🏓 Pingpong Review Escalation</h1>
    <div class="session-info">
      <h2>Session: {taskId}</h2>
      <p><strong>Status:</strong> Escalated (5 iterations completed)</p>
      <p><strong>Created:</strong> {timestamp}</p>
    </div>

    <div class="task-summary">
      <h3>Task Summary</h3>
      <p>{summary}</p>
      {if details}<p><strong>Details:</strong> {details}</p>{endif}
    </div>

    <div class="feedback-history">
      <h3>Review Feedback History ({iterationCount} iterations)</h3>
      {foreach iteration in feedbackLoop}
      <div class="iteration">
        <h4>Iteration {iteration.number} - {iteration.reviewerType}</h4>
        <p><strong>Status:</strong> {iteration.status}</p>
        <p><strong>Feedback:</strong> {iteration.feedback}</p>
        <p><em>{timestamp}</em></p>
      </div>
      {endforeach}
    </div>

    <div class="context-preview">
      <h3>Context</h3>
      <details>
        <summary>PRD ({prdPath})</summary>
        <pre>{prdContent}</pre>
      </details>
      <details>
        <summary>Git Diff ({gitDiffLength} bytes)</summary>
        <pre>{gitDiffContent}</pre>
      </details>
      {if conversationHistory}
      <details>
        <summary>Conversation History</summary>
        <pre>{conversationHistory}</pre>
      </details>
      {endif}
    </div>

    <div class="human-feedback">
      <h3>Human Review Required</h3>
      <p>Local LLM reached maximum iterations (5). Please review and provide feedback:</p>
      <form id="feedbackForm">
        <textarea name="feedback" rows="6" cols="80"
                  placeholder="Enter your feedback here... Type 'ok', 'approved', or 'lgtm' to approve the work."></textarea>
        <div class="quick-actions">
          <button type="button" data-quick="ok">✅ Approve (ok)</button>
          <button type="button" data-quick="approved">✅ Approve (approved)</button>
          <button type="button" data-quick="lgtm">✅ Approve (lgtm)</button>
        </div>
        <button type="submit">Submit Feedback</button>
      </form>
    </div>
  </div>
</body>
</html>
```

**Form Behavior:**
- Quick action buttons pre-fill the textarea with 'ok', 'approved', or 'lgtm'
- On submit: POST to `/api/sessions/{sessionId}/feedback` with `{feedback: string}`
- After successful submission: Show confirmation "Feedback submitted. Agent will continue."
- Page auto-refreshes every 30 seconds to check for session updates

## Logging

**Log Levels:**
- **Error:** LLM failures, escalation events
- **Warning:** PRD not found, git repo not found
- **Info:** Session created, LLM called, response received, iteration count

**Log Format:**
```
[ERROR] 2026-03-14T10:30:45Z LLM connection refused: http://127.0.0.1:8080
[WARN]  2026-03-14T10:30:46Z PRD not found, checked: ./docs/PRD.md, ./PRD.md, ./README.md
[INFO]  2026-03-14T10:30:47Z Review session created: task-20260314-001
[INFO]  2026-03-14T10:30:48Z Calling LLM with context (summary + PRD + git diff + history)
[INFO]  2026-03-14T10:31:20Z LLM response: STATUS: needs_revision
[INFO]  2026-03-14T10:31:21Z Iteration 2/5
```

## Session Management

**Session Storage:** `/tmp/pingpong-sessions/`

**Session Structure:**
```typescript
interface ReviewSession {
  sessionId: string;
  taskId: string;
  summary: string;
  details?: string;
  conversationHistory?: string;
  status: 'pending' | 'approved' | 'needs_revision' | 'escalated';
  feedback?: string;
  iterationCount: number;
  reviewerType: 'llm' | 'human';
  prdPath?: string;
  gitDiff?: string;
  createdAt: number;
  updatedAt: number;
}
```

**Session Lifecycle & State Transitions:**

**1. Initial Creation**
- Agent calls `request_review` → session created with:
  - `status: 'pending'`
  - `iterationCount: 0`
  - `createdAt: Date.now()`

**2. LLM Review (Iteration N, where N ≤ 5)**
- Pingpong sends context to LLM
- On response:
  - If `STATUS: approved` → `status: 'approved'`, `reviewerType: 'llm'`, session complete
  - If `STATUS: needs_revision` → `status: 'needs_revision'`, `reviewerType: 'llm'`, `feedback` set

**3. Agent Receives Feedback**
- Agent receives tool result with `status` and `feedback`
- `iterationCount` increments (N → N+1)
- If `status: 'approved'` → agent stops, task complete
- If `status: 'needs_revision'` → agent improves work, calls `request_review` again

**4. Escalation (Iteration N = 6, or LLM error after retry)**
- On 6th `request_review` call (after 5 completed iterations):
  - `status: 'escalated'`
  - Escalation server starts on port 3456
  - Browser auto-opens to web UI
- Or, if LLM fails after 1 retry:
  - `status: 'escalated'`
  - Escalation server starts

**5. Human Review (During Escalation)**
- Human reviews session via web UI
- On human feedback submission:
  - If human types `ok`, `approved`, or `lgtm` → `status: 'approved'`, `reviewerType: 'human'`
  - Otherwise → `status: 'needs_revision'`, `reviewerType: 'human'`, `feedback` set

**6. Post-Escalation Agent Iteration**
- Agent receives human feedback as tool result
- `iterationCount` does NOT increment (human escalation resets iteration limit)
- If `status: 'approved'` → agent stops, task complete
- If `status: 'needs_revision'` → agent improves work, calls `request_review` again
- Note: Subsequent `request_review` calls restart at step 2 (LLM reviews again)

**7. Session Completion**
- Session marked complete when `status: 'approved'`
- No further `request_review` calls allowed for this `sessionId`

**8. Cleanup**
- Sessions older than 24 hours deleted automatically
- Cleanup runs hourly via `setInterval`
1. Agent calls `request_review` → session created (status: pending)
2. LLM reviews → status updated (approved/needs_revision)
3. Agent receives feedback → iteration count increments
4. If approved → session closed
5. If max iterations (5) → status: escalated, web UI starts
6. Human reviews → status updated (approved/needs_revision)
7. Cleanup: Delete sessions older than 24 hours (runs hourly)

## Security Considerations

### Local LLM Communication
- Only communicates with localhost (127.0.0.1) by default
- No authentication required (local only)
- Validates LLM responses to prevent injection

### File System Access
- Reads PRD from project directory (user-controlled)
- Reads git diff (git commands)
- Writes sessions to `/tmp/` (world-readable)
- No privileged operations

### Web UI (Escalation)
- Binds to localhost:3456 only
- No external network access
- Stateless (no auth needed, local only)

### Input Validation
- Task ID: Alphanumeric + dashes only
- Summary/details: Truncate to prevent memory issues
- Conversation history: Optional, truncate if excessive
- PRD path: Validate within project directory

## Performance Considerations

### LLM Timeout
- Default: 1800 seconds (30 minutes)
- Configurable via `PINGPONG_LLM_TIMEOUT` env var or config file
- Long timeout allows thorough reviews of large codebases

### Session Cleanup
- Runs hourly via `setInterval`
- Deletes sessions older than 24 hours
- Prevents disk bloat in `/tmp/`

### Git Diff Performance
- `git diff HEAD` reads unstaged + staged changes
- **Truncation behavior for large diffs:**
  - Measure: Raw diff output size (unified diff format)
  - Threshold: 100KB (configurable via `gitDiff.maxSizeBytes` in config)
  - Truncation point: End of diff (keep beginning)
  - Warning: Log `[WARN] Git diff truncated from X bytes to 100KB`
  - LLM prompt: Append `<note>Git diff was truncated due to size. Showing first 100KB.</note>`
  - Rationale: Beginning of diff shows file context and initial changes


### Concurrency
- Multiple agents can create separate sessions
- Sessions identified by unique sessionId
- No shared state between sessions (filesystem only)

## Future Enhancements (Out of Scope for v1.0)

- Support for multiple PRD files (multi-module projects)
- Custom review criteria per project
- Integration with CI/CD pipelines
- Review history analytics
- Support for other local LLM backends (Ollama, LocalAI)
- Configurable review strictness levels
- Parallel review (multiple LLMs for cross-validation)
- Review templates by language/framework

## Success Criteria

### Functional Requirements
- ✅ Agent can call `request_review` tool
- ✅ Pingpong auto-detects PRD
- ✅ Pingpong reads git diff automatically
- ✅ Local LLM receives comprehensive context
- ✅ Local LLM returns structured feedback (STATUS: approved/needs_revision)
- ✅ Agent iterates based on feedback
- ✅ Escalation to human after 5 iterations or LLM errors
- ✅ Web UI displays session history
- ✅ Human feedback returned to agent
- ✅ HTTP API available for monitoring

### Non-Functional Requirements
- ✅ Zero premium request cost for iterations (all via MCP)
- ✅ 80%+ test coverage
- ✅ Comprehensive review criteria (6 categories)
- ✅ Clear installation instructions (LLM-installable)
- ✅ Error handling for all failure modes
- ✅ Logging for debugging
- ✅ Session cleanup (24-hour retention)

### User Experience
- ✅ Setup takes < 5 minutes via LLM installation
- ✅ Agent behavior clearly documented (APPEND_SYSTEM.md)
- ✅ Local LLM behavior clearly documented (AGENTS.md)
- ✅ Web UI is intuitive (copilot-leecher style)
- ✅ Troubleshooting guide in README

## Risks & Mitigations

| Risk | Impact | Probability | Mitigation |
|---|---|---|---|
| LLM returns unparseable response | High | Medium | STATUS: prefix requirement, escalation fallback |
| LLM timeout on large codebases | Medium | Medium | Configurable 30-min timeout, retry logic |
| PRD not found | Low | High | Warning log, continue with criteria only |
| Git repo not initialized | Low | Medium | Warning log, continue without diff |
| Escalation UI fails to start | High | Low | Retry with different port, log error |
| Session corruption | Low | Low | Validation, cleanup on error |
| llama.cpp not running | High | Medium | Retry once, escalate to human |

## Open Questions

None at this time. Design is complete and approved.

## Appendix

### Example Review Session

**Agent Call:**
```typescript
request_review({
  taskId: "feature-20260314-001",
  summary: "Implemented user authentication with JWT tokens. Added login endpoint, token validation middleware, and refresh token rotation. Assumed user store is PostgreSQL.",
  conversationHistory: "User: Add auth. Agent: What type? User: JWT. Agent: Implemented with refresh rotation."
})
```

**Context Sent to LLM:**
```
TASK SUMMARY: Implemented user authentication with JWT tokens. Added login endpoint, token validation middleware, and refresh token rotation. Assumed user store is PostgreSQL.

PRD: [Content of ./docs/PRD.md describing auth requirements]

GIT DIFF:
diff --git a/src/auth/login.ts b/src/auth/login.ts
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/src/auth/login.ts
@@ -0,0 +1,45 @@
+export async function login(username: string, password: string) {
+  // Implementation...
+}
[... full diff ...]

CONVERSATION HISTORY:
User: Add auth.
Agent: What type?
User: JWT.
Agent: Implemented with refresh rotation.

REVIEW CRITERIA:
[Full 6-category criteria from Built-in Review Criteria section]
```

**LLM Response:**
```
STATUS: needs_revision

Issues found:
1. Security: No rate limiting on login endpoint (vulnerable to brute force)
2. Security: JWT secret should be in environment variable, not hardcoded
3. Correctness: Token expiration not validated on refresh endpoint
4. Documentation: Missing JSDoc for login function

Fix these and resubmit for review.
```

**Agent Iteration 2:**
Agent fixes issues, calls `request_review` again...

**LLM Response (Iteration 2):**
```
STATUS: approved

Excellent work! All security issues addressed, code is clean and well-documented. Ready to merge.
```

**Agent Confirms:**
```
✅ Task feature-20260314-001 approved after 2 iterations. User authentication with JWT implemented securely.
```

---

**End of PRD**

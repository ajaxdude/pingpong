# Pingpong - Automated Code Review MCP (Save Premium Requests from GitHub Copilot)

**Automated code review for MCP agents, designed to minimize GitHub Copilot premium requests using a local LLM (llama.cpp). Inspired by copilot-leecher.**

Pingpong is an MCP (Model Context Protocol) review server that enables agents to iterate on their work without burning Copilot premium request quota. Every review loop happens via a local LLM instead of a human reviewer:
- Automated reviews (up to 5): each agent request triggers evaluation by a local LLM (llama.cpp) against PRD, code diff, and built-in criteria.
- **Zero premium request cost:** follow-up improvements, refactors, and fixes cost nothing until human escalation.
- **Human escalation:** after 5 incomplete attempts or LLM errors, pingpong starts a web UI for manual feedback, keeping you in control only when automation fails.
- Inspired by [copilot-leecher](https://github.com/yosebyte/copilot-leecher): all agent review iterations are free, human requests are rare, and PRD/context are always enforced.

**Ideal for Oh My Pi and any MCP-compatible agent system.**


---
**Agent Integration and LLM Prompt Setup**

To enable MCP review with pingpong for agents (in Oh My Pi, etc.), follow these steps:

## 1. APPEND_SYSTEM.md Setup (Global Agent Rules)

- If you DO NOT have `~/.omp/agent/APPEND_SYSTEM.md`:
  - Copy `templates/APPEND_SYSTEM.md` from this repo to `~/.omp/agent/APPEND_SYSTEM.md`.
  - This file establishes the global contract: always use `request_review` after completing work; all reviews must be approved before shipping.
  - No review loop = no merge, no completion.
- If you ALREADY HAVE `~/.omp/agent/APPEND_SYSTEM.md`:
  - Open your existing file.
  - Append the "### 3. Review loop via pingpong" section (found in `templates/APPEND_SYSTEM.md` or below) to your file if not present.
  - Ensure the section describing review loop rules matches the pingpong workflow.
  - If your file only has "copilot-leecher" review, add or replace it with pingpong details as below:

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
- "ok" / "approved" / "lgtm" → task complete
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

## 2. AGENTS.md Setup (Local LLM Prompt)

- If you do NOT have `~/.omp/agent/AGENTS.md`:
  - Copy `templates/AGENTS.md` from this repo to `~/.omp/agent/AGENTS.md`.
- If you ALREADY HAVE `~/.omp/agent/AGENTS.md`:
  - Add the Pingpong instructions to your existing file; do not remove other rules unless they conflict.

**Pingpong Local LLM Review Instructions:** See below or `templates/AGENTS.md`.
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
---
# Pingpong - Automated Code Review MCP

Pingpong is an MCP (Model Context Protocol) server that provides automated code review using a local LLM instead of human review. Inspired by copilot-leecher, pingpong replaces the human-in-the-loop with an automated review system powered by llama.cpp, enabling agents to iterate on work within a single premium request while maintaining thorough code quality standards.

## Key Differentiators from Copilot-Leecher

| Aspect | Copilot-Leecher | Pingpong |
|---|---|---|
| Reviewer | Human via web UI | Local LLM (llama.cpp) |
| Review Trigger | Every request | Every request |
| Escalation | N/A (always human) | After 5 completed iterations (escalates on 6th call) or LLM error |
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

## Hardware-Specific Setup: Strix Halo Max+ 395 (Fedora)

If your system is an AMD Strix Halo Max+ 395 (Radeon 8060S) and running Fedora, the recommended (preferred) way to install llama.cpp is using the toolbox from:
https://github.com/kyuz0/amd-strix-halo-toolboxes
This toolbox builds llama.cpp optimized for Strix Halo hardware and configures system dependencies for maximum performance. Follow instructions in that repo.

**Summary:**
- Clone the toolbox repo.
- Follow the readme to build and install llama.cpp.
- Confirm llama.cpp is running on port 8080 before launching pingpong.

## Prerequisites

- **Node.js:** v20 or higher
- **llama.cpp:** Must be running on port 8080 (default endpoint)
  - Install and setup: https://github.com/ggerganov/llama.cpp
  - Ensure the server is running: `http://127.0.0.1:8080/v1/chat/completions`

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd pingpong
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## Configuration

Create `pingpong.config.json` in your project root:

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

### Environment Variable Overrides

- `PINGPONG_LLM_ENDPOINT` - Override LLM endpoint
- `PINGPONG_LLM_MODEL` - Override model name
- `PINGPONG_LLM_TIMEOUT` - Override timeout (seconds)
- `PINGPONG_PRD_PATH` - Override PRD path

## Usage

### MCP Client Setup

Configure your MCP client to use pingpong:

```json
{
  "mcpServers": {
    "pingpong": {
      "command": "node",
      "args": ["/path/to/pingpong/dist/index.js"],
      "env": {}
    }
  }
}
```

### Escalation Server

When automation fails (after 5 iterations or LLM errors), pingpong starts an HTTP server:

- **Web UI:** `http://localhost:3456`
- **Auto-opens browser** by default (configurable)
- **Human provides feedback** via the web interface

### HTTP API (Monitoring)

Available when escalation server is running:

- `GET /api/sessions` - List all sessions
- `GET /api/sessions/pending` - List pending sessions
- `GET /api/sessions/:id` - Get session details
- `GET /api/health` - Health check

## Testing

Run tests:

```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests only
npm run test:integration

# Watch mode
npm run watch
```

## Troubleshooting

### LLM Connection Issues

**Error:** Connection refused to http://127.0.0.1:8080

**Solution:**
- Verify llama.cpp is running: `curl http://127.0.0.1:8080/v1/models`
- Check llama.cpp is started with correct port: `llama-server -p 8080`
- Verify no firewall blocking the connection

### PRD Not Detected

**Issue:** Pingpong can't find your PRD

**Solution:**
- Ensure PRD exists at one of: `./docs/PRD.md`, `./PRD.md`, or `./README.md`
- Or configure `pingpong.config.json` with custom PRD paths

### Iteration Limit Exceeded

**Issue:** After 5 iterations, pingpong escalates to human

**Solution:**
- Review the feedback and improve your implementation
- The human escalation UI opens automatically (if `autoOpenBrowser: true`)
- If disabled, open `http://localhost:3456` manually

### TypeScript Compilation Errors

**Solution:**
```bash
# Check for TypeScript errors
npx tsc --noEmit

# Rebuild
npm run build
```

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
│   └── escalation-server.ts     # HTTP server for human review
├── tests/
│   ├── unit/                    # Unit tests
│   └── integration/             # Integration tests
├── templates/
│   ├── APPEND_SYSTEM.md         # Agent installation template
│   └── AGENTS.md                # LLM system prompt template
├── dist/                        # Compiled output
├── pingpong.config.example.json # Example configuration
└── package.json
```

## License

MIT License

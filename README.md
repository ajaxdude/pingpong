# Pingpong - Automated Code Review MCP

Automated code review using a local LLM (llama.cpp) instead of human review. Inspired by [copilot-leecher](https://github.com/yosebyte/copilot-leecher).

**Why Pingpong?**
- Every agent review loop goes to your local LLM, not the cloud. Zero cost for iteration.
- Human escalation (web UI) happens only after 5 failed reviews or LLM errors.
- Enforces PRD-driven reviews: context, PRD, git diff, and agent history are always included.
- Universal contract: all agent harnesses must use MCP `request_review` and get approval before shipping.

---


## 🧑 Installation for Humans

### Prerequisites
- Node.js v20 or higher
- llama.cpp running on port 8080 (default endpoint)

### Quick Start

```bash
# Clone and install
git clone https://github.com/your-repo/pingpong.git
cd pingpong
npm install && npm run build

# Configure in your project root
cp pingpong.config.example.json pingpong.config.json
# Edit pingpong.config.json to set your LLM endpoint

# Configure MCP client (see below)
```

### MCP Client Setup

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "pingpong": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/pingpong/dist/index.js"]
    }
  }
}
```

**Example for Oh My Pi:**
```json
{
  "mcpServers": {
    "pingpong": {
      "type": "stdio",
      "command": "node",
      "args": ["/home/papa/ai/stack/pingpong/dist/index.js"]
    }
  }
}
```

<<<<<<< HEAD
### Configuration
=======
- **Node.js:** v20 or higher
- **llama.cpp:** Must be running on port 8080 (default endpoint)
  - Install and setup: https://github.com/ggerganov/llama.cpp
  - Ensure the server is running: `http://127.0.0.1:8080/v1/chat/completions`

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/ajaxdude/pingpong.git
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
>>>>>>> 0c9986d (docs: update repository URL in README)

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

---

## 🔄 How It Works

1. Agent completes work and calls `request_review(taskId, summary, details?, conversationHistory?)`
2. Pingpong creates session and auto-reads:
   - Project PRD (from `./docs/PRD.md`, `./PRD.md`, or `./README.md`)
   - Git diff (`git diff HEAD`)
   - Conversation history (if provided)
3. Sends comprehensive context to local LLM (llama.cpp:8080)
4. Receives structured feedback:
   - `STATUS: approved` → task complete
   - `STATUS: needs_revision` → agent improves and retries
5. After 5 iterations or LLM error, escalates to human via web UI at `http://localhost:3456`

---

## 📋 Agent Contract

Pingpong provides `APPEND_SYSTEM.md` template for installation at `~/.omp/agent/APPEND_SYSTEM.md`:

```markdown
### 3. Review loop via pingpong

After completing all work, you MUST call the `request_review` tool:
- `taskId`: format `[type]-[date]-[seq]` — e.g. `feature-20260314-001`
- `summary`: 2–3 sentences covering what changed, why, and assumptions
- `conversationHistory` (optional): Include full conversation if it provides important context
- `details` (optional): Additional technical context

**What pingpong reviews:**
- Your task summary and details
- Project PRD (auto-detected)
- Git diff (unstaged + staged changes via `git diff HEAD`)
- Conversation history (if provided)
- Built-in criteria: correctness, quality, security, performance, maintainability, documentation

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

---

## 🏗️ Architecture

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

---

## 🧪 Testing

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

---

## 🔧 Troubleshooting

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

---

## 📦 Project Structure

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
│   └── LLAMACPP.md                # LLM system prompt template
├── dist/                        # Compiled output
├── pingpong.config.example.json # Example configuration
└── package.json
```

---

## 📄 License

MIT License

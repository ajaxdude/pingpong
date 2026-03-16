# Pingpong

**Save on GitHub Copilot queries by using local LLM instead of cloud APIs.**

This tool is proven to work and recommended to be used with [oh-my-pi](https://github.com/can1357/oh-my-pi). Inspired by [Copilot-Leecher](https://github.com/xiangxiaobo/Copilot-Leecher).

## Quick Start

### For Oh-My-Pi Users

```bash
curl -sSL https://raw.githubusercontent.com/ajaxdude/pingpong/master/install.sh | bash
```

This single command will:
- Clone the repo to `~/.omp/skills/pingpong/`
- Install dependencies and build
- Configure pingpong in your project automatically
- Start the MCP server

### Manual Installation

```bash
# Install
git clone https://github.com/ajaxdude/pingpong.git
cd pingpong
npm install && npm run build

# Configure in your project root
cp pingpong.config.example.json pingpong.config.json
# Edit pingpong.config.json to set your LLM endpoint if needed (default: http://127.0.0.1:8080/v1/chat/completions)
```

## MCP Client Setup

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

## Usage

### For Agents

After completing work, call `request_review(taskId, summary, details?, conversationHistory?)`:

- `taskId`: format `[type]-[date]-[seq]` — e.g., `feature-20260316-001`
- `summary`: 2–3 sentences covering what changed and why

**What gets reviewed:**
- Task summary + details
- Project PRD (auto-detected from `./docs/PRD.md`, `./PRD.md`, or `./README.md`)
- Git diff (`git diff HEAD`)
- Conversation history (if provided)
- Built-in criteria: correctness, quality, security, performance, maintainability

**Review Process:**
1. Local LLM reviews your work → returns `approved`, `needs_revision`, or `escalated`
2. If `needs_revision` → improve based on feedback and retry
3. After 5 iterations → escalates to browser UI at `http://localhost:3456`
4. Human provides feedback → `"ok"`/`"approved"`/`"lgtm"` → task complete

### Connection Failure Handling

When llama.cpp isn't running, pingpong automatically:
1. Detects connection errors (`ECONNREFUSED`, `ENOTFOUND`, `ECONNRESET`)
2. Opens browser with setup instructions
3. Shows llama.cpp installation and startup guide
4. Auto-refreshes to detect when service becomes available

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

**Environment Variables:**
- `PINGPONG_LLM_ENDPOINT` - Override LLM endpoint
- `PINGPONG_LLM_MODEL` - Override model name
- `PINGPONG_LLM_TIMEOUT` - Override timeout (seconds)
- `PINGPONG_PRD_PATH` - Override PRD path

## Troubleshooting

**LLM Connection Issues**
```bash
# Verify llama.cpp is running
curl http://127.0.0.1:8080/v1/models

# Start llama.cpp on port 8080
llama-server -p 8080 -m path/to/model.gguf
```

**PRD Not Detected**
- Ensure PRD exists at: `./docs/PRD.md`, `./PRD.md`, or `./README.md`
- Or configure custom PRD paths in `pingpong.config.json`

**TypeScript Errors**
```bash
# Check and rebuild
npx tsc --noEmit
npm run build
```

## License

MIT
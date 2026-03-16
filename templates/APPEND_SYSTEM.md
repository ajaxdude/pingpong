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

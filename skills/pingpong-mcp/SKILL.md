# pingpong-mcp Skill

## Tool: pingpong/request_review

{
  "tool_name": "pingpong/request_review",
  "description": "Submit code chunks for review via the pingpong MCP server. Returns review results, status, and any feedback.",
  "parameters": {
    "summary": "string (required) - Brief summary of the task for review.",
    "taskId": "string (required) - Unique identifier for the task.",
    "conversationHistory": "array (optional) - History/context for the review.",
    "details": "string (optional) - Additional technical information."
  }
}

## Handler

- Script: scripts/request_review.py
- Invoked by OMP automatically on tool call.

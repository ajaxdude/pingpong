#!/usr/bin/env python3
import sys
import json
import requests

# MCP pingpong server endpoint
MCP_URL = "http://localhost:8080/request_review"

def main():
    try:
        # Read JSON input from stdin
        args = json.load(sys.stdin)
        # Pass through required fields to MCP server
        payload = {
            "summary": args.get("summary", ""),
            "taskId": args.get("taskId", ""),
            "conversationHistory": args.get("conversationHistory", []),
            "details": args.get("details", "")
        }
        # Send to MCP
        resp = requests.post(MCP_URL, json=payload)
        resp.raise_for_status()
        # Print out server response as JSON
        print(json.dumps(resp.json()))
    except Exception as e:
        # Robust error: always emit error info as JSON
        print(json.dumps({"error": str(e)}))

if __name__ == "__main__":
    main()

#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionManager } from './session-manager.js';
import { loadConfig, DEFAULT_CONFIG } from './config.js';
import { RequestReviewInput, RequestReviewResult } from './types.js';

// Read version from package.json
const packageJson = readFileSync(join(process.cwd(), 'package.json'), 'utf-8');
const { version } = JSON.parse(packageJson);

// Global state
let sessionManager: SessionManager | null = null;
let config = DEFAULT_CONFIG;

// Create MCP server
const mcpServer = new Server(
  {
    name: 'pingpong',
    version: version,
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool handlers
async function handleRequestReview(
  args: RequestReviewInput
): Promise<RequestReviewResult> {
  if (!sessionManager) {
    throw new Error('Session manager not initialized');
  }

  const session = sessionManager.createSession({
    taskId: args.taskId,
    summary: args.summary,
    details: args.details,
    conversationHistory: args.conversationHistory,
  });

  return {
    status: 'pending',
    feedback: 'Review request submitted',
    sessionId: session.id,
    iterationCount: 0,
    reviewerType: 'llm',
  };
}

async function handleGetSessionList(): Promise<{ sessions: Array<{ id: string; taskId: string; status: string; summary: string }> }> {
  if (!sessionManager) {
    return { sessions: [] };
  }

  const sessions = sessionManager.listSessions();
  return {
    sessions: sessions.map((s) => ({
      id: s.id,
      taskId: s.taskId,
      status: s.status,
      summary: s.summary,
    })),
  };
}

async function handleGetSessionDetails(sessionId: string): Promise<any> {
  if (!sessionManager) {
    return null;
  }

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return null;
  }

  return {
    id: session.id,
    taskId: session.taskId,
    status: session.status,
    summary: session.summary,
    details: session.details,
    llmFeedback: session.llmFeedback,
    humanFeedback: session.humanFeedback,
    escalationReason: session.escalationReason,
    iterationCount: session.iterationCount,
    reviewerType: session.reviewerType,
  };
}

async function handleResolveSession(sessionId: string, feedback: string): Promise<void> {
  if (!sessionManager) {
    throw new Error('Session manager not initialized');
  }

  sessionManager.resolveSession(sessionId, feedback);
}

// Initialize session manager
async function initializeComponents(): Promise<void> {
  try {
    const projectRoot = process.cwd();
    const sessionDir = join(projectRoot, '.pingpong', 'sessions');
    sessionManager = new SessionManager(sessionDir);
    console.error('[INFO] Session manager initialized');
  } catch (error) {
    console.error('[WARN] Session manager initialization failed:', error);
    sessionManager = null;
  }
}

// Set up request handlers
function setupRequestHandlers(): void {
  // List available tools
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'request_review',
        description:
          'Request a code review for a task. After calling this tool, wait for expert feedback.',
        inputSchema: {
          type: 'object',
          properties: {
            taskId: {
              type: 'string',
              description: 'The task ID to review',
            },
            summary: {
              type: 'string',
              description: 'Brief summary of the task',
            },
            details: {
              type: 'string',
              description: 'Additional details about the task',
            },
            conversationHistory: {
              type: 'array',
              items: { type: 'string' },
              description: 'Conversation history as context',
            },
          },
          required: ['taskId', 'summary'],
        },
      },
      {
        name: 'get_session_list',
        description: 'Returns list of all review sessions',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'get_session_details',
        description: 'Returns details for a specific session',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to retrieve',
            },
          },
          required: ['sessionId'],
        },
      },
      {
        name: 'resolve_session',
        description: 'Resolve a session with feedback',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              description: 'The session ID to resolve',
            },
            feedback: {
              type: 'string',
              description: 'Feedback for resolving the session',
            },
          },
          required: ['sessionId', 'feedback'],
        },
      },
    ],
  }));

  // Handle tool calls
  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    
    switch (name) {
      case 'request_review': {
        const result = await handleRequestReview((args as unknown) as RequestReviewInput);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      }
      
      case 'get_session_list': {
        const result = await handleGetSessionList();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      }
      
      case 'get_session_details': {
        const result = await handleGetSessionDetails((args as unknown as any).sessionId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result),
            },
          ],
        };
      }
      
      case 'resolve_session': {
        await handleResolveSession((args as unknown as any).sessionId, (args as unknown as any).feedback);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ success: true }),
            },
          ],
        };
      }
      
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  });
}

// Error handling
mcpServer.onerror = (error) => {
  console.error('[MCP Error]', error);
};

process.on('SIGINT', async () => {
  await mcpServer.close();
  process.exit(0);
});

// Main function to start the server
async function main(): Promise<void> {
  // Initialize minimal components
  await initializeComponents();
  
  // Set up request handlers
  setupRequestHandlers();
  
  // Connect to transport immediately (like copilot-leecher)
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[INFO] Pingpong MCP server running on stdio');
}

// Start the server
main().catch((error) => {
  console.error('[ERROR] Failed to start MCP server:', error);
  process.exit(1);
});
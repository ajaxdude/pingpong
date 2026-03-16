import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { SessionManager } from './session-manager.js';
import { loadConfig, DEFAULT_CONFIG } from './config.js';
import { RequestReviewInput, RequestReviewResult } from './types.js';
import * as z from 'zod';

// Read version from package.json
const packageJson = readFileSync(join(process.cwd(), 'package.json'), 'utf-8');
const { version } = JSON.parse(packageJson);

// Global state
let sessionManager: SessionManager | null = null;
let config = DEFAULT_CONFIG;

// Create MCP server (non-nullable)
const mcpServer = new McpServer(
  {
    name: 'pingpong',
    version: version,
  },
  {
    capabilities: {},
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

// Initialize with config
async function initializeServer(): Promise<void> {
  try {
    const projectRoot = process.cwd();
    config = await loadConfig(projectRoot);
    console.error(`[INFO] Config loaded successfully with escalation port ${config.escalation.port}`);

    // Initialize session manager with config
    const sessionDir = join(projectRoot, '.pingpong', 'sessions');
    try {
      sessionManager = new SessionManager(sessionDir);
      console.error('[INFO] Session manager initialized successfully');
    } catch (error) {
      console.error('[WARN] Session manager initialization failed, continuing without it:', error);
      sessionManager = null;
    }
  } catch (error) {
    console.error('[WARN] Config loading failed, using defaults:', error);
    console.error('[INFO] Using default configuration');

    // Initialize session manager even if config fails
    const projectRoot = process.cwd();
    const sessionDir = join(projectRoot, '.pingpong', 'sessions');
    try {
      sessionManager = new SessionManager(sessionDir);
      console.error('[INFO] Session manager initialized successfully');
    } catch (initError) {
      console.error('[WARN] Session manager initialization failed:', initError);
      sessionManager = null;
    }
  }
}

// Register tools
mcpServer.registerTool('request_review', {
  description: 'Request a code review for a task',
  inputSchema: {
    taskId: z.string().describe('The task ID to review'),
    summary: z.string().describe('Brief summary of the task'),
    details: z.string().optional().describe('Additional details about the task'),
    conversationHistory: z.array(z.string()).optional().describe('Conversation history as context'),
  },
}, async (args) => {
  const result = await handleRequestReview(args);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result),
      },
    ],
  };
});

mcpServer.registerTool('get_session_list', {
  description: 'Returns list of all review sessions',
}, async (args) => {
  const result = await handleGetSessionList();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result),
      },
    ],
  };
});

mcpServer.registerTool('get_session_details', {
  description: 'Returns details for a specific session',
  inputSchema: {
    sessionId: z.string().describe('The session ID to retrieve'),
  },
}, async (args) => {
  const result = await handleGetSessionDetails(args.sessionId);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result),
      },
    ],
  };
});

mcpServer.registerTool('resolve_session', {
  description: 'Resolve a session with feedback',
  inputSchema: {
    sessionId: z.string().describe('The session ID to resolve'),
    feedback: z.string().describe('Feedback for resolving the session'),
  },
}, async (args) => {
  await handleResolveSession(args.sessionId, args.feedback);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ success: true }),
      },
    ],
  };
});

// Main function to start the server
async function main(): Promise<void> {
  await initializeServer();
  
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[INFO] MCP server connected via stdio');
}

// Export for use in index.js
export { mcpServer, initializeServer, main };

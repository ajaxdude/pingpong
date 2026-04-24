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
import { createReviewLoop } from './review-loop.js';
import { startEscalationServer, stopEscalationServer } from './escalation-server.js';
import { initializeModelRouter, modelRouter } from './router.js';
import { RequestReviewInput, RequestReviewResult } from './types.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
const packageJson = readFileSync(join(__dirname, '..', 'package.json'), 'utf-8');
const { version } = JSON.parse(packageJson);

// Signal handling for graceful shutdown
let shutdownInProgress = false;

async function setupSignalHandlers(): Promise<void> {
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    
    console.error(`\n[INFO] Received ${signal}, starting graceful shutdown...`);
    
    try {
      // Stop escalation server if started
      await stopEscalationServer();
      console.error('[INFO] Shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('[ERROR] Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  process.on('uncaughtException', (error) => {
    console.error('[ERROR] Uncaught exception:', error);
    if (!shutdownInProgress) {
      process.exit(1);
    }
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    console.error('[ERROR] Unhandled rejection at:', promise, 'reason:', reason);
    if (!shutdownInProgress) {
      process.exit(1);
    }
  });
}

// Global state
let sessionManager: SessionManager | null = null;
let config = DEFAULT_CONFIG;
let reviewLoop: any = null;
let escalationServer: any = null;

// Rate limiting state
const requestTimestamps = new Map<string, number[]>();
const MAX_REQUESTS_PER_MINUTE = 10;

// Rate limiting helper
function checkRateLimit(clientId: string): boolean {
  const now = Date.now();
  const timestamps = requestTimestamps.get(clientId) || [];

  // Filter timestamps from the last minute
  const recentRequests = timestamps.filter(t => t > now - 60_000);

  if (recentRequests.length >= MAX_REQUESTS_PER_MINUTE) {
    console.warn(`[MCP Server] Rate limit exceeded for client ${clientId}`);
    return false;
  }

  // Add current timestamp and clean up old ones
  recentRequests.push(now);
  requestTimestamps.set(clientId, recentRequests);

  // Clean up timestamps older than 5 minutes
  const allTimestamps = requestTimestamps.get(clientId) || [];
  const validTimestamps = allTimestamps.filter(t => t > now - 300_000);
  requestTimestamps.set(clientId, validTimestamps);

  return true;
}
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

  // Check rate limit
  const clientId = args.taskId || 'unknown';
  if (!checkRateLimit(clientId)) {
    throw new Error('Rate limit exceeded. Please try again later.');
  }

  // Create exactly ONE session. The review loop operates on this same session
  // so the ID returned to the agent is always the one being updated.
  const session = sessionManager.createSession({
    taskId: args.taskId,
    summary: args.summary,
    details: args.details,
    conversationHistory: args.conversationHistory,
  });

  if (!reviewLoop) {
    console.warn('[MCP] No review loop available; session created but no LLM review will run');
    return {
      status: 'pending',
      feedback: 'Review request submitted (no LLM backend configured)',
      sessionId: session.id,
      iterationCount: 0,
      reviewerType: 'llm',
    };
  }

  // Block until the review loop completes (approved / needs_revision / escalated).
  // The loop updates the session in-place; we wait for its return value so we
  // can hand back the real terminal status to the agent rather than 'pending'.
  //
  // Note: MCP stdio keeps the connection open while the tool call is in-flight,
  // so long-running calls are fine. The agent sees no response until this resolves.
  try {
    const result = await reviewLoop.startReviewOnSession(
      session.id,
      args.taskId,
      args.summary,
      args.details,
      args.conversationHistory
    );

    return {
      status: result.status,
      feedback: result.feedback,
      sessionId: session.id,
      iterationCount: result.iterationCount,
      reviewerType: result.reviewerType,
    };
  } catch (err: any) {
    // Loop threw — mark session escalated so dashboard shows it
    sessionManager.updateSession(session.id, {
      status: 'escalated',
      feedback: String(err?.message || err),
      reviewerType: 'llm',
    });
    return {
      status: 'escalated',
      feedback: String(err?.message || err),
      sessionId: session.id,
      iterationCount: 0,
      reviewerType: 'llm',
    };
  }
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

    // Load configuration
    try {
      config = await loadConfig(projectRoot);
      console.error('[INFO] Configuration loaded successfully for MCP');
      
      console.error('[WARN] ⚠️  Pingpong is DEPRECATED and has been renamed to brainrouter.');
      console.error('[WARN] ⚠️  Please migrate to brainrouter for new features and updates.');
      console.error('[WARN] ⚠️  Repo: https://github.com/ajaxdude/brainrouter');

      // Initialize model router AFTER config is successfully loaded and validated
      try {
        initializeModelRouter(config);
      } catch (err: any) {
        console.warn('[WARN] Model router initialization failed, continuing with defaults:', err?.message || err);
      }
    } catch (err: any) {
      console.warn('[WARN] Configuration loading failed for MCP, using defaults');
      config = DEFAULT_CONFIG;
    }

    // Initialize review loop so MCP can trigger LLM reviews
    try {
      if (sessionManager && config) {
        reviewLoop = createReviewLoop(sessionManager, config as any);
        console.error('[INFO] Review loop initialized in MCP server');
      }
    } catch (err: any) {
      console.warn('[WARN] Review loop initialization failed in MCP server:', err?.message || err);
      reviewLoop = null;
    }

    // Start escalation server (dashboard) if enabled in config
    try {
      if (config?.escalation?.enabled) {
        const port = config.escalation.port;
        
        // Check if port is already in use before starting to avoid unhandled errors from listen()
        import('net').then(net => new Promise<void>(resolve => {
          const checkServer = net.createServer();
          try {
            checkServer.listen(port, '127.0.0.1', () => {
              // Port was free - we'll start the server
              checkServer.close(() => resolve());
              startEscalationServer({
                port: config.escalation.port,
                sessionManager: sessionManager,
                config: config,
                resolveSessionCallback: (sessionId: string, feedback: string) => {
                  console.error("[MCP] Escalation resolved session " + sessionId + " with feedback");

                  if (sessionManager) sessionManager.resolveSession(sessionId, feedback);
                },
              });
              console.error('[INFO] Escalation server started on port ' + config.escalation.port);
            }).on('error', (err: NodeJS.ErrnoException) => {
              // Port is in use
              checkServer.close(() => resolve());
              if (err.code === 'EADDRINUSE') {
                console.warn('[WARN] Escalation server port ' + port + ' already in use - skipping');
              } else {
                console.error('[MCP] Net error:', err.message);
              }
            });
          } catch {}
        })).catch(err => {
          if (err.code === 'EADDRINUSE') {
            console.warn('[WARN] Escalation server port ' + port + ' already in use - skipping');
          } else {
            console.error('[MCP] Net import failed:', err.message);
          }
        });
      }
    } catch (err: any) {
      console.warn('[WARN] Failed to start escalation server in MCP process:', err?.message || err);
    }
  } catch (error) {
    console.error('[WARN] Global initialization failed in MCP:', error);
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
      {
        name: 'mcp_pingpong_select_model',
        description:
          'DEPRECATED: Use brainrouter select_model instead. This tool picks the cheapest sufficient model before significant LLM calls.',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The task prompt or description.',
            },
            context: {
              type: 'string',
              description: 'Optional extra context prepended before routing.',
            },
          },
          required: ['prompt'],
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

      case 'mcp_pingpong_select_model': {
        const result = await modelRouter.selectModel((args as any).prompt);
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
  // Set up signal handlers first
  await setupSignalHandlers();

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
// Export for testing/verification
export { mcpServer, initializeComponents as initializeServer, handleRequestReview };

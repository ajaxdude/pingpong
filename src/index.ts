#!/usr/bin/env node

import { loadConfig } from './config.js';
import { SessionManager } from './session-manager.js';
import { createReviewLoop } from './review-loop.js';
import { startEscalationServer, stopEscalationServer } from './escalation-server.js';
import { mcpServer, initializeServer } from './mcp-server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createLLMClient } from './llm-client.js';
import { ReviewLoop } from './review-loop.js';
import { PingpongConfig } from './types.js';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Global state
let sessionManager: SessionManager | null = null;
let reviewLoop: ReviewLoop | null = null;
let config: PingpongConfig | null = null;
let escalationServerStarted = false;

// Signal handling for graceful shutdown
let shutdownInProgress = false;

async function setupSignalHandlers(): Promise<void> {
  const shutdown = async (signal: string) => {
    if (shutdownInProgress) return;
    shutdownInProgress = true;
    
    console.log(`\n[INFO] Received ${signal}, starting graceful shutdown...`);
    
    try {
      // Stop escalation server if started
      if (escalationServerStarted) {
        console.log('[INFO] Stopping escalation server...');
        await stopEscalationServer();
        escalationServerStarted = false;
      }
      
      // Perform any additional cleanup here
      console.log('[INFO] Shutdown completed');
      
      // Exit with success
      process.exit(0);
    } catch (error) {
      console.error('[ERROR] Error during shutdown:', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function initializeComponents(): Promise<void> {
  try {
    console.log('[INFO] Initializing Pingpong...');
    
    // Load configuration
    const projectRoot = process.cwd();
    config = await loadConfig(projectRoot);
    console.log('[INFO] Configuration loaded successfully');
    
    // Initialize session manager
    const sessionDir = join(projectRoot, '.pingpong', 'sessions');
    try {
      sessionManager = new SessionManager(sessionDir);
      console.log('[INFO] Session manager initialized');
    } catch (error) {
      console.warn('[WARN] Session manager initialization failed:', error);
      sessionManager = null;
    }
    
    // Initialize review loop
    if (sessionManager) {
      try {
        reviewLoop = createReviewLoop(sessionManager, config);
        console.log('[INFO] Review loop initialized');
      } catch (error) {
        console.warn('[WARN] Review loop initialization failed:', error);
        reviewLoop = null;
      }
    }
    
    // Start escalation server if enabled
    if (config.escalation.enabled) {
      let escalationServer;
      try {
        escalationServer = startEscalationServer({
          port: config.escalation.port,
          sessionManager: sessionManager,
          resolveSessionCallback: (sessionId: string, feedback: string) => {
            console.log(`[INFO] Session ${sessionId} resolved with feedback`);
            if (sessionManager) {
              sessionManager.resolveSession(sessionId, feedback);
            }
          },
        });
        escalationServerStarted = true;
        console.log(`[INFO] Escalation server started on port ${config.escalation.port}`);
        console.log(`[INFO] Escalation UI: http://localhost:${config.escalation.port}`);
      } catch (error) {
        console.warn('[WARN] Escalation server startup failed:', error);
      }
    }
    
    console.log('[INFO] All components initialized successfully');
    
  } catch (error) {
    console.error('[ERROR] Failed to initialize components:', error);
    throw error;
  }
}

async function main(): Promise<void> {
  try {
    // Set up signal handlers first
    await setupSignalHandlers();
    
    // Initialize all components
    await initializeComponents();
    
    // Initialize MCP server
    await initializeServer();
    
    // Start MCP server via stdio transport
    console.log('[INFO] Starting MCP server...');
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);
    
    console.log('[INFO] Pingpong MCP server started successfully');
    console.log('[INFO] Waiting for MCP client connection...');
    
    // Keep the process alive
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
    
  } catch (error) {
    console.error('[ERROR] Failed to start Pingpong:', error);
    process.exit(1);
  }
}

// Run the main function
main().catch((error) => {
  console.error('[ERROR] Fatal error in main:', error);
  process.exit(1);
});

// Export for testing
export { main, initializeComponents, sessionManager, reviewLoop, config };
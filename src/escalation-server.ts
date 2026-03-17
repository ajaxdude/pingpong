import express, { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { SessionManager } from './session-manager.js';
import { RequestReviewResult, ReviewStatus } from './types.js';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

interface EscalationServer {
  start: () => Promise<express.Express>;
  stop: () => Promise<void>;
  port: number;
  appInstance: express.Express | null;
}

interface EscalationServerOptions {
  port?: number;
  sessionManager?: SessionManager | null;
  resolveSessionCallback?: (sessionId: string, feedback: string) => void;
}

let serverInstance: EscalationServer | null = null;
let appInstance: express.Express | null = null;

/**
 * Start the escalation server
 */
export function startEscalationServer(
  options: EscalationServerOptions
): EscalationServer {
  const { port = 3456, sessionManager } = options;

  // Return existing instance if server already started
  if (serverInstance) {
    console.log('[Escalation Server] Server already running on port', port);
    return serverInstance;
  }

  const app = express();
  
  // Middleware setup
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Middleware to set headers for all responses
  app.use((req: Request, res: Response, next) => {
    res.setHeader('X-Powered-By', 'Pingpong/Escalation-Server');
    next();
  });

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, next: any) => {
    console.error('[Escalation Server] Error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
    });
  });

  // GET /api/health - Health check
  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      server: 'pingpong-escalation',
    });
  });

  // GET /api/sessions - List all sessions
  app.get('/api/sessions', (_req: Request, res: Response) => {
    if (!sessionManager) {
      res.json({
        sessions: [],
        count: 0,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    
    const sessions = sessionManager.listSessions();
    res.json({
      sessions: sessions.map(s => ({
        id: s.id,
        taskId: s.taskId,
        status: s.status,
        summary: s.summary,
        details: s.details,
        escalationReason: s.escalationReason,
        iterationCount: s.iterationCount,
        reviewerType: s.reviewerType,
        llmFeedback: s.llmFeedback,
        humanFeedback: s.humanFeedback,
      })),
      timestamp: new Date().toISOString(),
    });
  });

  // GET /review-requests - Dashboard for all review requests
  app.get('/review-requests', (_req: Request, res: Response) => {
    try {
      const templatePath = join(__dirname, '..', 'templates', 'review-requests.html');
      let template = readFileSync(templatePath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(template);
    } catch (err) {
      console.error('[Escalation Server] Failed to render review-requests dashboard:', err);
      res.status(500).send(createErrorHTML('Failed to load review requests dashboard'));
    }
  });

  // GET /review/:sessionId - Render HTML template with session data
  app.get('/review/:sessionId', (req: Request, res: Response) => {
    const { sessionId } = req.params;
    
    if (!sessionManager) {
      res.status(503).send(createErrorHTML('Session manager not available'));
      return;
    }

    const session = sessionManager.getSession(sessionId);
    
    if (!session) {
      res.status(404).send(createErrorHTML(`Session not found: ${sessionId}`));
      return;
    }

    // Check if this is a connection failure - show setup page instead
    if (session.escalationReason === 'connection_failed') {
      try {
        const templatePath = join(__dirname, '..', 'templates', 'setup.html');
        let template = readFileSync(templatePath, 'utf-8');

        // Replace endpoint in the template
        const endpoint = process.env.PINGPONG_LLM_ENDPOINT || 'http://127.0.0.1:8080/v1/chat/completions';
        template = template.replace(/\{\{endpoint\}\}/g, endpoint);

        res.setHeader('Content-Type', 'text/html');
        res.send(template);
      } catch (err) {
        console.error('[Escalation Server] Failed to render setup template:', err);
        res.status(500).send(createErrorHTML('Failed to load setup page. Please ensure llama.cpp is running on port 8080.'));
      }
      return;
    }

    try {
      const templatePath = join(__dirname, '..', 'templates', 'escalation.html');
      let template = readFileSync(templatePath, 'utf-8');

      // Simple template rendering
      template = template
        .replace(/\{\{id\}\}/g, session.id)
        .replace(/\{\{taskId\}\}/g, session.taskId)
        .replace(/\{\{summary\}\}/g, session.summary || '')
        .replace(/\{\{iterationCount\}\}/g, String(session.iterationCount))
        .replace(/\{\{status\}\}/g, session.status || '')
        .replace(/\{\{llmFeedback\}\}/g, session.llmFeedback || '')
        .replace(/\{\{error\}\}/g, '')
        .replace(/\{\{#error\}\}[\s\S]*?\{\{\/error\}\}/g, '')
        .replace(/\{\{\^error\}\}([\s\S]*?)\{\{\/error\}\}/g, '$1');

      res.setHeader('Content-Type', 'text/html');
      res.send(template);
    } catch (err) {
      console.error('[Escalation Server] Failed to render template:', err);
      res.status(500).send(createErrorHTML('Failed to load review page'));
    }
  });

  // POST /api/sessions/:id/feedback - Submit feedback
  app.post('/api/sessions/:id/feedback', (req: Request, res: Response) => {
    const { id: sessionId } = req.params;
    const { feedback } = req.body;

    // Validate feedback
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      res.status(400).json({
        error: 'Missing feedback',
        message: 'Feedback is required and cannot be empty',
      });
      return;
    }

    if (!sessionManager) {
      res.status(503).json({
        error: 'Service unavailable',
        message: 'Session manager not available',
      });
      return;
    }

    const session = sessionManager.getSession(sessionId);

    if (!session) {
      res.status(404).json({
        error: 'Session not found',
        message: `Session not found: ${sessionId}`,
      });
      return;
    }

    // Update session with human feedback
    sessionManager.updateSession(sessionId, {
      status: 'escalated' as ReviewStatus,
      feedback: feedback.trim(),
      reviewerType: 'human',
    });

    // Call resolveSession callback if available
    const callback = session.agentResolve;
    if (!callback) {
      console.warn('[Escalation Server] No resolve callback for session:', sessionId);
    } else {
      const result: RequestReviewResult = {
        status: 'escalated' as ReviewStatus,
        feedback: feedback.trim(),
        sessionId: session.id,
        iterationCount: session.iterationCount,
        reviewerType: 'human',
      };
      callback(result);
    }

    res.json({
      success: true,
      sessionId,
      feedback: feedback.trim(),
    });
  });

  // Start server
  const server = app.listen(port, () => {
    console.log(`[Escalation Server] Running on http://localhost:${port}`);
    console.log(`[Escalation Server] Health check: http://localhost:${port}/api/health`);
    console.log(`[Escalation Server] Dashboard: http://localhost:${port}/review-requests`);
  });

  serverInstance = {
    start: async () => {
      console.log('[Escalation Server] Server already started');
      return app;
    },
    stop: async () => {
      return new Promise<void>((resolve) => {
        server.close(() => {
          console.log('[Escalation Server] Server stopped');
          serverInstance = null;
          appInstance = null;
          resolve();
        });
      });
    },
    port,
    appInstance: app,
  };

  appInstance = app;

  return serverInstance;
}

/**
 * Get the current server instance
 */
export function getEscalationServer(): EscalationServer | null {
  return serverInstance;
}

/**
 * Create error HTML page
 */
function createErrorHTML(message: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error - Escalation Server</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .error-container {
      background: white;
      padding: 40px;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      text-align: center;
      max-width: 400px;
    }
    .error-container h1 {
      color: #e74c3c;
      margin-bottom: 20px;
    }
    .error-container p {
      color: #666;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <h1>Error</h1>
    <p>${message}</p>
  </div>
</body>
</html>
  `;
}

/**
 * Stop the escalation server
 */
export async function stopEscalationServer(): Promise<void> {
  if (serverInstance) {
    await serverInstance.stop();
  }
}

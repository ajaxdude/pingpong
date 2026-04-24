import express, { Request, Response } from 'express';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { SessionManager } from './session-manager.js';
import { ReviewStatus } from './types.js';
import { getRouteEvents } from './router.js';
import mustache from 'mustache';

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
  config?: any;
}

let serverInstance: EscalationServer | null = null;
let appInstance: express.Express | null = null;

/**
 * Start the escalation server
 */
export function startEscalationServer(
  options: EscalationServerOptions
): EscalationServer {
  const { port = 3456, sessionManager, config } = options;

  // Return existing instance if server already started
  if (serverInstance) {
    console.error('[Escalation Server] Server already running on port', port);
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
      count: sessions.length,
      timestamp: new Date().toISOString(),
    });
  });

  // DELETE /api/sessions/:id - Delete a session
  app.delete('/api/sessions/:id', (req: Request, res: Response) => {
    const { id: sessionId } = req.params;

    if (!sessionManager) {
      res.status(503).json({ error: 'Service unavailable', message: 'Session manager not available' });
      return;
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found', message: `Session not found: ${sessionId}` });
      return;
    }

    sessionManager.deleteSessionFile(sessionId);
    res.json({ success: true, sessionId });
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

  // GET / - Routing dashboard
  app.get('/', (_req: Request, res: Response) => {
    try {
      const templatePath = join(__dirname, '..', 'templates', 'routing-dashboard.html');
      let template = readFileSync(templatePath, 'utf-8');
      res.setHeader('Content-Type', 'text/html');
      res.send(template);
    } catch (err) {
      console.error('[Escalation Server] Failed to render routing dashboard:', err);
      res.status(500).send(createErrorHTML('Failed to load routing dashboard'));
    }
  });

  // GET /api/routing-events - Get routing events
  app.get('/api/routing-events', (_req: Request, res: Response) => {
    const events = getRouteEvents();
    res.json({
      events,
      total: events.length,
      timestamp: new Date().toISOString(),
    });
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
        const template = readFileSync(templatePath, 'utf-8');

        // Replace endpoint in the template
        const endpoint = process.env.PINGPONG_LLM_ENDPOINT || 'http://127.0.0.1:8080/v1/chat/completions';
        const html = mustache.render(template, { endpoint });

        res.setHeader('Content-Type', 'text/html');
        res.send(html);
      } catch (err) {
        console.error('[Escalation Server] Failed to render setup template:', err);
        res.status(500).send(createErrorHTML('Failed to load setup page. Please ensure llama.cpp is running on port 8080.'));
      }
      return;
    }

    try {
      const templatePath = join(__dirname, '..', 'templates', 'escalation.html');
      const template = readFileSync(templatePath, 'utf-8');
      
      // Explicitly pick only template-required fields to avoid leaking 
      // in-memory callbacks (agentResolve) into the view.
      const view = {
        id: session.id,
        taskId: session.taskId,
        summary: session.summary,
        details: session.details ?? '',
        status: session.status,
        llmFeedback: session.llmFeedback ?? '',
        humanFeedback: session.humanFeedback ?? '',
        escalationReason: session.escalationReason ?? '',
        iterationCount: session.iterationCount,
        reviewerType: session.reviewerType ?? '',
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        error: false,
      };
      
      const html = mustache.render(template, view);
      res.setHeader('Content-Type', 'text/html');
      res.send(html);
    } catch (err) {
      console.error('[Escalation Server] Failed to render template:', err);
      res.status(500).send(createErrorHTML('Failed to load review page'));
    }
  });

  // POST /api/sessions/:id/feedback - Submit feedback
  app.post('/api/sessions/:id/feedback', (req: Request, res: Response) => {
    const { id: sessionId } = req.params;
    const feedback = req.body.feedback;

    // Validate feedback
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      res.status(400).json({ error: 'Missing feedback', message: 'Feedback is required and cannot be empty' });
      return;
    }

    if (!sessionManager) {
      res.status(503).json({ error: 'Service unavailable', message: 'Session manager not available' });
      return;
    }

    const session = sessionManager.getSession(sessionId);
    if (!session) {
      res.status(404).json({ error: 'Session not found', message: `Session not found: ${sessionId}` });
      return;
    }

    const trimmedFeedback = feedback.trim();
    // Approval if feedback starts with a recognized approval signal (case-insensitive)
    const isApproval = /^(ok|lgtm|approved|looks good|ship it)/i.test(trimmedFeedback);
    const finalStatus: ReviewStatus = isApproval ? 'approved' : 'needs_revision';

    // Update session with human feedback and correct status
    sessionManager.updateSession(sessionId, {
      status: finalStatus,
      feedback: trimmedFeedback,
      reviewerType: 'human',
    });

    // Fire the agentResolve callback via resolveSession
    sessionManager.resolveSession(sessionId, trimmedFeedback);

    res.json({ success: true, sessionId, feedback: trimmedFeedback, status: finalStatus });
  });

  // Start server
  const server = app.listen(port, () => {
    console.error(`[Escalation Server] Running on http://localhost:${port}`);
    console.error(`[Escalation Server] Health check: http://localhost:${port}/api/health`);
    console.error(`[Escalation Server] Dashboard: http://localhost:${port}/review-requests`);
  });

  serverInstance = {
    start: async () => {
      console.error('[Escalation Server] Server already started');
      return app;
    },
    stop: async () => {
      return new Promise<void>((resolve) => {
        server.close(() => {
          console.error('[Escalation Server] Server stopped');
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

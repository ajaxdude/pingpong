import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { ReviewLoop, createReviewLoop } from '../../dist/review-loop.js';
import { SessionManager } from '../../dist/session-manager.js';
import { PingpongConfig, ReviewStatus } from '../../dist/types.js';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

interface TestSessionDir {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a test session directory
 */
async function createTestSessionDir(): Promise<TestSessionDir> {
  const path = `/tmp/test-integration-sessions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await mkdir(path, { recursive: true });
  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true }),
  };
}

/**
 * Create a config pointing to a mock LLM server
 */
function createConfig(llmPort: number, maxIterations: number = 3): PingpongConfig {
  return {
    llm: {
      endpoint: `http://127.0.0.1:${llmPort}/api/chat`,
      model: 'mock-llm',
      temperature: 0.2,
      maxTokens: 4096,
      timeout: 10000,
    },
    prd: {
      file: 'PRD.md',
      prompt: null,
      autoDetect: true,
      paths: [],
      fallbackPath: null,
    },
    review: {
      timeout: 30000,
      maxIterations,
      requiredApprovals: 1,
      retryOnLlmError: true,
    },
    escalation: {
      enabled: true,
      timeout: 30000,
      notify: [],
      port: 3456,
      autoOpenBrowser: true,
    },
    gitDiff: {
      enabled: true,
      contextLines: 3,
      maxSizeBytes: 100 * 1024,
    },
  };
}

/**
 * Simple mock LLM server for testing
 */
async function startMockLLMServer(port: number, responseFn: (req: any) => { status: string; feedback: string }) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      if (req.url === '/api/health' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'healthy', server: 'pingpong-mock-llm' }));
        return;
      }

      if (req.url === '/api/chat' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          try {
            const request = JSON.parse(body);
            const response = responseFn(request);

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              choices: [{
                message: {
                  role: 'assistant',
                  content: JSON.stringify({ status: response.status, feedback: response.feedback }),
                },
                finish_reason: 'stop',
              }],
            }));
          } catch (err) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Internal server error' }));
          }
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    });

    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

describe('Review Flow Integration Tests', () => {
  describe('End-to-End Review Cycles', () => {
    it('should approve on first iteration when LLM returns approved', async () => {
      const sessionDir = await createTestSessionDir();
      let llmServer: any = null;

      try {
        // Start mock LLM server in approve mode
        llmServer = await startMockLLMServer(11435, () => ({
          status: 'approved',
          feedback: 'Code looks good! All changes are approved.',
        }));

        // Create config pointing to mock LLM
        const config = createConfig(11435, 3);

        // Create session manager
        const sessionManager = new SessionManager(sessionDir.path);

        // Create review loop
        const reviewLoop = createReviewLoop(sessionManager, config);

        // Run review
        const result = await reviewLoop.startReview(
          'task-001',
          'Add user authentication',
          'Implement JWT-based auth with refresh tokens'
        );

        // Verify results
        expect(result.status).toBe('approved');
        expect(result.feedback).toContain('Code looks good');
        expect(result.iterationCount).toBe(1);
        expect(result.reviewerType).toBe('llm');

        // Verify session was created
        const session = sessionManager.getSession(result.sessionId);
        expect(session).toBeDefined();
        expect(session?.status).toBe('approved');
        expect(session?.taskId).toBe('task-001');
        expect(session?.iterationCount).toBe(0); // iterationCount is 0 before any increment

      } finally {
        if (llmServer) {
          await new Promise(resolve => llmServer.close(resolve));
        }
        await sessionDir.cleanup();
      }
    }, 30000);

    it('should handle needs_revision and approve on second iteration', async () => {
      const sessionDir = await createTestSessionDir();
      let llmServer: any = null;
      let callCount = 0;

      try {
        // Start mock LLM server in cycle mode (revision -> approval)
        llmServer = await startMockLLMServer(11436, () => {
          callCount++;
          if (callCount === 1) {
            return {
              status: 'needs_revision',
              feedback: 'Iteration 1: Please add more tests.',
            };
          } else {
            return {
              status: 'approved',
              feedback: 'Iteration 2: Tests added, approved!',
            };
          }
        });

        // Create config pointing to mock LLM
        const config = createConfig(11436, 5);

        // Create session manager
        const sessionManager = new SessionManager(sessionDir.path);

        // Create review loop
        const reviewLoop = createReviewLoop(sessionManager, config);

        // Run review
        const result = await reviewLoop.startReview(
          'task-002',
          'Fix memory leak in data processor',
          'Add proper cleanup for event listeners'
        );

        // Verify results - should need revision then approve
        expect(result.status).toBe('approved');
        expect(result.iterationCount).toBe(2);
        expect(result.reviewerType).toBe('llm');

        // Verify session was updated correctly
        const session = sessionManager.getSession(result.sessionId);
        expect(session).toBeDefined();
        expect(session?.status).toBe('approved');
        expect(session?.iterationCount).toBe(1); // After 2 iterations, count is 1 (increment happens after each non-approved iteration)

      } finally {
        if (llmServer) {
          await new Promise(resolve => llmServer.close(resolve));
        }
        await sessionDir.cleanup();
      }
    }, 30000);

    it('should respect maxIterations and return needs_revision when limit reached', async () => {
      const sessionDir = await createTestSessionDir();
      let llmServer: any = null;

      try {
        // Start mock LLM server in revision mode (always needs revision)
        llmServer = await startMockLLMServer(11437, () => ({
          status: 'needs_revision',
          feedback: 'Please add more tests and fix the linting issues.',
        }));

        // Create config with maxIterations = 2
        const config = createConfig(11437, 2);

        // Create session manager
        const sessionManager = new SessionManager(sessionDir.path);

        // Create review loop
        const reviewLoop = createReviewLoop(sessionManager, config);

        // Run review
        const result = await reviewLoop.startReview(
          'task-003',
          'Refactor authentication service',
          'Extract user validation into separate module'
        );

        // Verify results - should be stuck in revision after max iterations
        expect(result.status).toBe('needs_revision');
        expect(result.iterationCount).toBe(2);
        expect(result.reviewerType).toBe('llm');

        // Verify session reflects the final state
        const session = sessionManager.getSession(result.sessionId);
        expect(session).toBeDefined();
        expect(session?.status).toBe('needs_revision');
        expect(session?.iterationCount).toBe(2); // After 2 iterations with needs_revision, count is 2


      } finally {
        if (llmServer) {
          await new Promise(resolve => llmServer.close(resolve));
        }
        await sessionDir.cleanup();
      }
    }, 30000);

    it('should escalate when LLM is unavailable', async () => {
      const sessionDir = await createTestSessionDir();

      try {
        // Create config pointing to non-existent LLM
        const config = createConfig(19999, 3);

        // Create session manager
        const sessionManager = new SessionManager(sessionDir.path);

        // Create review loop
        const reviewLoop = createReviewLoop(sessionManager, config);

        // Run review - should escalate due to LLM unavailability
        const result = await reviewLoop.startReview(
          'task-004',
          'Add caching layer',
          'Implement Redis cache for user sessions'
        );

        // Verify results - should escalate
        expect(result.status).toBe('escalated');
        expect(result.feedback).toContain('Failed to get LLM response');
        expect(result.iterationCount).toBe(1);

        // Verify session was created with escalated status
        const session = sessionManager.getSession(result.sessionId);
        expect(session).toBeDefined();
        expect(session?.status).toBe('escalated');

      } finally {
        await sessionDir.cleanup();
      }
    }, 30000);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'fs/promises';
import { RequestReviewResult, ReviewStatus, ReviewSession } from '../../dist/types.js';
import { SessionManager } from '../../dist/session-manager.js';
import { startEscalationServer, stopEscalationServer, getEscalationServer } from '../../dist/escalation-server.js';

interface TestSessionDir {
  path: string;
  cleanup: () => Promise<void>;
}

/**
 * Create a test session directory
 */
async function createTestSessionDir(): Promise<TestSessionDir> {
  const path = `/tmp/test-escalation-sessions-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await mkdir(path, { recursive: true });
  return {
    path,
    cleanup: () => rm(path, { recursive: true, force: true }),
  };
}

describe('Escalation Flow Integration Tests', () => {
  let sessionDir: TestSessionDir | null = null;

  beforeEach(async () => {
    sessionDir = await createTestSessionDir();
  });

  afterEach(async () => {
    if (sessionDir) {
      await sessionDir.cleanup();
    }
    const server = getEscalationServer();
    if (server) {
      await stopEscalationServer();
    }
  });

  describe('Session Escalation', () => {
    it('should escalate after max iterations and allow human approval', async () => {
      const sessionManager = new SessionManager(sessionDir!.path);

      // Create a session that needs escalation (high iteration count)
      const session = sessionManager.createSession({
        taskId: 'task-escalation-1',
        summary: 'Critical bug fix needed',
        details: 'Production crash in payment processing',
      });

      // Simulate max iterations by setting iteration count and status
      for (let i = 0; i < 5; i++) {
        sessionManager.incrementIteration(session.id);
      }
      sessionManager.updateSession(session.id, {
        status: 'needs_revision',
        reviewerType: 'llm',
      });

      // Verify session state before escalation
      const beforeSession = sessionManager.getSession(session.id);
      expect(beforeSession?.iterationCount).toBe(5);
      expect(beforeSession?.status).toBe('needs_revision');

      // Start escalation server
      const server = startEscalationServer({
        port: 3458,
        sessionManager,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify server is running
      const healthResponse = await fetch(`http://localhost:${server.port}/api/health`);
      expect(healthResponse.status).toBe(200);
      const healthData = await healthResponse.json();
      expect(healthData.status).toBe('healthy');

      // Simulate human approval via POST /api/sessions/:id/feedback
      const feedbackResponse = await fetch(`http://localhost:${server.port}/api/sessions/${session.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Approved by human reviewer' }),
      });

      expect(feedbackResponse.status).toBe(200);
      const feedbackData = await feedbackResponse.json();
      expect(feedbackData.success).toBe(true);
      expect(feedbackData.feedback).toBe('Approved by human reviewer');

      // Verify session was updated
      const afterSession = sessionManager.getSession(session.id);
      expect(afterSession?.status).toBe('escalated');
      expect(afterSession?.humanFeedback).toBe('Approved by human reviewer');
      expect(afterSession?.reviewerType).toBe('human');

    }, 30000);

    it('should trigger escalation callback when human provides feedback', async () => {
      const sessionManager = new SessionManager(sessionDir!.path);

      // Create a session
      const session = sessionManager.createSession({
        taskId: 'task-escalation-2',
        summary: 'Performance optimization needed',
      });

      // Set up resolve callback
      let callbackResult: RequestReviewResult | null = null;
      let callbackCalled = false;

      sessionManager.setResolveCallback(session.id, (result) => {
        callbackResult = result;
        callbackCalled = true;
      });

      // Start escalation server
      const server = startEscalationServer({
        port: 3459,
        sessionManager,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Submit feedback
      const feedbackResponse = await fetch(`http://localhost:${server.port}/api/sessions/${session.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Approved with recommendations' }),
      });

      expect(feedbackResponse.status).toBe(200);

      // Verify callback was called
      expect(callbackCalled).toBe(true);
      expect(callbackResult).toBeDefined();
      expect(callbackResult?.sessionId).toBe(session.id);
      expect(callbackResult?.feedback).toBe('Approved with recommendations');
      expect(callbackResult?.iterationCount).toBe(0); // Callback is called with current session state (0 before any increments)
      expect(callbackResult?.reviewerType).toBe('human');

    }, 30000);
  });

  describe('Escalation UI', () => {
    it('should serve HTML for /review/:sessionId endpoint', async () => {
      const sessionManager = new SessionManager(sessionDir!.path);

      // Create a session with specific data
      const session = sessionManager.createSession({
        taskId: 'task-ui-1',
        summary: 'UI Enhancement: Add dark mode',
        details: 'Implement theme switcher with system preference detection',
      });

      // Start escalation server
      const server = startEscalationServer({
        port: 3460,
        sessionManager,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Fetch the review page
      const response = await fetch(`http://localhost:${server.port}/review/${session.id}`);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain('text/html');

      const html = await response.text();

      // Verify HTML contains session data
      expect(html).toContain('task-ui-1');
      expect(html).toContain('UI Enhancement: Add dark mode');
      expect(html).toContain('0'); // iteration count
      expect(html).toContain('pending'); // status

    }, 30000);

    it('should return 404 for non-existent session', async () => {
      const sessionManager = new SessionManager(sessionDir!.path);

      // Start escalation server
      const server = startEscalationServer({
        port: 3461,
        sessionManager,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Fetch non-existent session
      const response = await fetch(`http://localhost:${server.port}/review/non-existent-session-id`);

      expect(response.status).toBe(404);

      const html = await response.text();
      expect(html).toContain('Session not found');

    }, 30000);

    it('should update session when feedback is submitted via API', async () => {
      const sessionManager = new SessionManager(sessionDir!.path);

      // Create a session
      const session = sessionManager.createSession({
        taskId: 'task-api-1',
        summary: 'API version 2.0 update',
        details: 'Add pagination support to all list endpoints',
      });

      // Start escalation server
      const server = startEscalationServer({
        port: 3462,
        sessionManager,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Submit feedback via API
      const feedbackResponse = await fetch(`http://localhost:${server.port}/api/sessions/${session.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'API design approved, ready for implementation' }),
      });

      expect(feedbackResponse.status).toBe(200);
      const feedbackData = await feedbackResponse.json();
      expect(feedbackData.success).toBe(true);

      // Verify session was updated
      const updatedSession = sessionManager.getSession(session.id);
      expect(updatedSession).toBeDefined();
      expect(updatedSession!.status).toBe('escalated');
      expect(updatedSession!.humanFeedback).toBe('API design approved, ready for implementation');
      expect(updatedSession!.reviewerType).toBe('human');

    }, 30000);

    it('should return 400 for missing feedback', async () => {
      const sessionManager = new SessionManager(sessionDir!.path);

      // Create a session
      const session = sessionManager.createSession({
        taskId: 'task-validation-1',
        summary: 'Validation test',
      });

      // Start escalation server
      const server = startEscalationServer({
        port: 3463,
        sessionManager,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Submit feedback without body
      const response = await fetch(`http://localhost:${server.port}/api/sessions/${session.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing feedback');

    }, 30000);

    it('should return 404 for non-existent session feedback', async () => {
      const sessionManager = new SessionManager(sessionDir!.path);

      // Start escalation server
      const server = startEscalationServer({
        port: 3464,
        sessionManager,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Submit feedback for non-existent session
      const response = await fetch(`http://localhost:${server.port}/api/sessions/non-existent-id/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Test feedback' }),
      });

      expect(response.status).toBe(404);

    }, 30000);

    it('should return 503 when session manager is not available', async () => {
      // Start escalation server without session manager
      const server = startEscalationServer({
        port: 3465,
        sessionManager: null,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Try to submit feedback
      const response = await fetch(`http://localhost:${server.port}/api/sessions/test-id/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Test' }),
      });

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe('Service unavailable');

    }, 30000);
  });

  describe('List Sessions', () => {
    it('should return list of all sessions via /api/sessions', async () => {
      const sessionManager = new SessionManager(sessionDir!.path);

      // Create multiple sessions
      const session1 = sessionManager.createSession({
        taskId: 'task-list-1',
        summary: 'First session',
      });

      const session2 = sessionManager.createSession({
        taskId: 'task-list-2',
        summary: 'Second session',
      });

      // Start escalation server
      const server = startEscalationServer({
        port: 3466,
        sessionManager,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Fetch sessions list
      const response = await fetch(`http://localhost:${server.port}/api/sessions`);

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.sessions).toHaveLength(2);
      expect(data.count).toBe(2);

      const sessionIds = data.sessions.map((s: ReviewSession) => s.id);
      expect(sessionIds).toContain(session1.id);
      expect(sessionIds).toContain(session2.id);

    }, 30000);
  });
});

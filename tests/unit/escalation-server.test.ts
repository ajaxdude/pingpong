import { describe, it, expect, beforeEach, afterEach, vi, beforeAll, afterAll } from 'vitest';
import { startEscalationServer, stopEscalationServer, getEscalationServer } from '../../src/escalation-server.js';
import { SessionManager } from '../../src/session-manager.js';
import { ReviewStatus } from '../../src/types.js';
import { promises as fs } from 'fs';
const portGenerator = (function* () {
  let port = 3000;
  while (true) yield port++;
}());

describe('Escalation Server', () => {
  const mockSessionDir = '/tmp/test-escalation-sessions';
  let sessionManager: SessionManager;
  let server: any;
  let currentPort: number;

  beforeAll(async () => {
    // Clear session directory
    try {
      await fs.rm(mockSessionDir, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });

  afterAll(async () => {
    // Clean up
    try {
      await fs.rm(mockSessionDir, { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });

  beforeEach(() => {

    sessionManager = new SessionManager(mockSessionDir);
  });

afterEach(async () => {
  try {
    if (server) {
      await stopEscalationServer();
    }
  } finally {
    server = null;
  }
});

  describe('startEscalationServer', () => {
    it('starts server on configured port', async () => {
      currentPort = portGenerator.next().value;
      server = startEscalationServer({
        port: currentPort,
        sessionManager,
      });

      // Wait for server to start
      await new Promise(resolve => setTimeout(resolve, 100));

      const response = await fetch(`http://localhost:${currentPort}/api/health`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.server).toBe('pingpong-escalation');
    });

    it('returns existing server instance when called twice', async () => {
      currentPort = portGenerator.next().value;
      server = startEscalationServer({
        port: currentPort,
        sessionManager,
      });

      const server2 = startEscalationServer({
        port: currentPort + 1, // Different port
        sessionManager,
      });

      expect(server).toBe(server2);
      expect(server.port).toBe(currentPort);

      // Should still be running on original port
      const response = await fetch(`http://localhost:${currentPort}/api/health`);
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('healthy');
    });
  });

  describe('GET /api/health', () => {
    beforeEach(async () => {
      currentPort = portGenerator.next().value;
      server = startEscalationServer({
        port: currentPort,
        sessionManager,
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('returns health status', async () => {
      const response = await fetch(`http://localhost:${currentPort}/api/health`);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.status).toBe('healthy');
      expect(data.timestamp).toBeDefined();
      expect(data.server).toBe('pingpong-escalation');
    });
  });

  describe('GET /api/sessions', () => {
    beforeEach(async () => {
      currentPort = portGenerator.next().value;
      server = startEscalationServer({
        port: currentPort,
        sessionManager,
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('returns empty array when no sessions exist', async () => {
      const response = await fetch(`http://localhost:${currentPort}/api/sessions`);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessions).toEqual([]);
      expect(data.count).toBe(0);
    });

    it('returns list of sessions', async () => {
      // Create some sessions
      sessionManager.createSession({
        taskId: 'task-1',
        summary: 'Test session 1',
      });
      
      sessionManager.createSession({
        taskId: 'task-2',
        summary: 'Test session 2',
      });

      const response = await fetch(`http://localhost:${currentPort}/api/sessions`);
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.sessions).toHaveLength(2);
      expect(data.count).toBe(2);
      expect(data.sessions[0].taskId).toBe('task-1');
      expect(data.sessions[1].taskId).toBe('task-2');
    });
  });

  describe('GET /review/:sessionId', () => {
    beforeEach(async () => {
      currentPort = portGenerator.next().value;
      server = startEscalationServer({
        port: currentPort,
        sessionManager,
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('returns 404 for non-existent session', async () => {
      const response = await fetch(`http://localhost:${currentPort}/review/non-existent-id`);
      
      expect(response.status).toBe(404);
      const text = await response.text();
      expect(text).toContain('Session not found');
    });

    it('renders HTML template with session data', async () => {
      const session = sessionManager.createSession({
        taskId: 'test-task-123',
        summary: 'Test summary',
      });

      const response = await fetch(`http://localhost:${currentPort}/review/${session.id}`);
      
      expect(response.status).toBe(200);
      const contentType = response.headers.get('content-type');
      expect(contentType).toContain('text/html');
      const html = await response.text();
      expect(html).toContain('Test summary');
      expect(html).toContain('test-task-123');
      expect(html).toContain('0'); // iteration count
    });
  });

  describe('POST /api/sessions/:id/feedback', () => {
    beforeEach(async () => {
      currentPort = portGenerator.next().value;
      server = startEscalationServer({
        port: currentPort,
        sessionManager,
      });
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('returns 400 for missing feedback', async () => {
      const session = sessionManager.createSession({
        taskId: 'task-1',
        summary: 'Test',
      });

      const response = await fetch(`http://localhost:${currentPort}/api/sessions/${session.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe('Missing feedback');
    });

    it('returns 404 for non-existent session', async () => {
      const response = await fetch(`http://localhost:${currentPort}/api/sessions/non-existent-id/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Test feedback' }),
      });

      expect(response.status).toBe(404);
    });

    it('submits feedback and updates session', async () => {
      const session = sessionManager.createSession({
        taskId: 'task-1',
        summary: 'Test',
      });

      const response = await fetch(`http://localhost:${currentPort}/api/sessions/${session.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Great work!' }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.feedback).toBe('Great work!');

      // Verify session was updated
      const updatedSession = sessionManager.getSession(session.id);
      expect(updatedSession!.status).toBe('escalated');
      expect(updatedSession!.humanFeedback).toBe('Great work!');
      expect(updatedSession!.reviewerType).toBe('human');
    });

    it('calls resolveSession callback with feedback', async () => {
      const session = sessionManager.createSession({
        taskId: 'task-1',
        summary: 'Test',
      });

      let callbackCalled = false;
      let callbackResult: any = null;

      sessionManager.setResolveCallback(session.id, (result) => {
        callbackCalled = true;
        callbackResult = result;
      });

      await fetch(`http://localhost:${currentPort}/api/sessions/${session.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Approved!' }),
      });

      expect(callbackCalled).toBe(true);
      expect(callbackResult).toBeDefined();
      expect(callbackResult.status).toBe('escalated');
      expect(callbackResult.feedback).toBe('Approved!');
      expect(callbackResult.sessionId).toBe(session.id);
    });

    it('logs warning when resolveSession callback not set', async () => {
      const session = sessionManager.createSession({
        taskId: 'task-1',
        summary: 'Test',
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await fetch(`http://localhost:${currentPort}/api/sessions/${session.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: 'Test feedback' }),
      });

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('No resolve callback for session'),
        session.id
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('getEscalationServer', () => {
    it('returns current server instance', async () => {
      currentPort = portGenerator.next().value;
      server = startEscalationServer({
        port: currentPort,
        sessionManager,
      });

      const retrieved = getEscalationServer();
      expect(retrieved).toBeDefined();
      expect(retrieved?.port).toBe(currentPort);
    });

    it('returns null when server not running', async () => {
      const retrieved = getEscalationServer();
      expect(retrieved).toBeNull();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import * as fsSync from 'fs';
import { join } from 'path';
import { SessionManager } from '../../src/session-manager.js';
import { ReviewStatus, ReviewerType } from '../../src/types.js';

describe('SessionManager', () => {
  const mockSessionDir = '/tmp/test-sessions';
  let sessionManager: SessionManager;

  beforeEach(async () => {
    // Clear any existing mock files and directories
    try {
      await fs.rm(mockSessionDir, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist, which is fine
    }
    
    sessionManager = new SessionManager(mockSessionDir);
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await fs.rm(mockSessionDir, { recursive: true, force: true });
    } catch (error) {
      // Directory might not exist, which is fine
    }
  });

  describe('createSession', () => {
    it('creates session with UUID, pending status, 0 iteration count', () => {
      const sessionInput = {
        taskId: 'test-task-123',
        summary: 'Test session summary',
        details: 'Test session details',
        conversationHistory: ['Initial conversation']
      };

      const session = sessionManager.createSession(sessionInput);

      expect(session.id).toBeDefined();
      expect(session.id).toHaveLength(21); // nanoid default length
      expect(session.taskId).toBe('test-task-123');
      expect(session.summary).toBe('Test session summary');
      expect(session.details).toBe('Test session details');
      expect(session.conversationHistory).toEqual(['Initial conversation']);
      expect(session.status).toBe('pending' as ReviewStatus);
      expect(session.iterationCount).toBe(0);
      expect(session.reviewerType).toBeUndefined();
      expect(session.llmFeedback).toBeUndefined();
      expect(session.humanFeedback).toBeUndefined();
      expect(session.escalationReason).toBeUndefined();
    });

    it('creates session with minimal required fields', () => {
      const sessionInput = {
        taskId: 'test-task-456',
        summary: 'Minimal session'
      };

      const session = sessionManager.createSession(sessionInput);

      expect(session.id).toBeDefined();
      expect(session.taskId).toBe('test-task-456');
      expect(session.summary).toBe('Minimal session');
      expect(session.status).toBe('pending' as ReviewStatus);
      expect(session.iterationCount).toBe(0);
      expect(session.details).toBeUndefined();
      expect(session.conversationHistory).toBeUndefined();
    });

    it('creates session that persists to disk', async () => {
      const sessionInput = {
        taskId: 'test-task-persist',
        summary: 'Persist test session'
      };

      const session = sessionManager.createSession(sessionInput);
      
      // Read session file from disk
      const sessionFilePath = join(mockSessionDir, `${session.id}.json`);
      const sessionFileContent = await fs.readFile(sessionFilePath, 'utf8');
      const sessionData = JSON.parse(sessionFileContent);

      expect(sessionData.id).toBe(session.id);
      expect(sessionData.taskId).toBe('test-task-persist');
      expect(sessionData.status).toBe('pending');
      expect(sessionData.iterationCount).toBe(0);
      expect(sessionData.createdAt).toBeDefined();
      expect(sessionData.updatedAt).toBeDefined();
    });
  });

  describe('getSession', () => {
    it('retrieves session by ID', () => {
      const sessionInput = {
        taskId: 'test-retrieve-123',
        summary: 'Retrieve test session'
      };

      const createdSession = sessionManager.createSession(sessionInput);
      const retrievedSession = sessionManager.getSession(createdSession.id);

      expect(retrievedSession).toBeTruthy();
      expect(retrievedSession!.id).toBe(createdSession.id);
      expect(retrievedSession!.taskId).toBe('test-retrieve-123');
      expect(retrievedSession!.summary).toBe('Retrieve test session');
    });

    it('returns null for non-existent session', () => {
      const retrievedSession = sessionManager.getSession('non-existent-id');
      expect(retrievedSession).toBeNull();
    });

    it('returns null for invalid session ID', () => {
      const retrievedSession = sessionManager.getSession('');
      expect(retrievedSession).toBeNull();
    });
  });

  describe('updateSession', () => {
    it('updates session status', () => {
      const sessionInput = {
        taskId: 'test-update-123',
        summary: 'Update test session'
      };

      const session = sessionManager.createSession(sessionInput);
      
      sessionManager.updateSession(session.id, { status: 'approved' as ReviewStatus });
      
      const updatedSession = sessionManager.getSession(session.id);
      expect(updatedSession!.status).toBe('approved');
    });

    it('updates session reviewer type and feedback', () => {
      const sessionInput = {
        taskId: 'test-update-feedback-123',
        summary: 'Update feedback test session'
      };

      const session = sessionManager.createSession(sessionInput);
      
      sessionManager.updateSession(session.id, {
        reviewerType: 'human' as ReviewerType,
        feedback: 'Human feedback provided'
      });
      
      const updatedSession = sessionManager.getSession(session.id);
      expect(updatedSession!.reviewerType).toBe('human');
      expect(updatedSession!.humanFeedback).toBe('Human feedback provided');
      expect(updatedSession!.llmFeedback).toBeUndefined();
    });

    it('updates LLM feedback when reviewer type is human', () => {
      const sessionInput = {
        taskId: 'test-llm-feedback-123',
        summary: 'LLM feedback test session'
      };

      const session = sessionManager.createSession(sessionInput);
      
      sessionManager.updateSession(session.id, {
        reviewerType: 'llm' as ReviewerType,
        feedback: 'LLM feedback provided'
      });
      
      const updatedSession = sessionManager.getSession(session.id);
      expect(updatedSession!.reviewerType).toBe('llm');
      expect(updatedSession!.llmFeedback).toBe('LLM feedback provided');
      expect(updatedSession!.humanFeedback).toBeUndefined();
    });

    it('updates both status and feedback simultaneously', () => {
      const sessionInput = {
        taskId: 'test-multi-update-123',
        summary: 'Multi update test session'
      };

      const session = sessionManager.createSession(sessionInput);
      
      sessionManager.updateSession(session.id, {
        status: 'needs_revision' as ReviewStatus,
        reviewerType: 'human' as ReviewerType,
        feedback: 'Needs revision feedback'
      });
      
      const updatedSession = sessionManager.getSession(session.id);
      expect(updatedSession!.status).toBe('needs_revision');
      expect(updatedSession!.reviewerType).toBe('human');
      expect(updatedSession!.humanFeedback).toBe('Needs revision feedback');
    });

    it('does nothing when updating non-existent session', () => {
      expect(() => {
        sessionManager.updateSession('non-existent-id', { status: 'approved' as ReviewStatus });
      }).not.toThrow();
    });
  });

  describe('incrementIteration', () => {
    it('increments session iteration count', () => {
      const sessionInput = {
        taskId: 'test-increment-123',
        summary: 'Increment test session'
      };

      const session = sessionManager.createSession(sessionInput);
      
      sessionManager.incrementIteration(session.id);
      
      const updatedSession = sessionManager.getSession(session.id);
      expect(updatedSession!.iterationCount).toBe(1);
    });

    it('increments iteration count multiple times', () => {
      const sessionInput = {
        taskId: 'test-multi-increment-123',
        summary: 'Multi increment test session'
      };

      const session = sessionManager.createSession(sessionInput);
      
      sessionManager.incrementIteration(session.id);
      sessionManager.incrementIteration(session.id);
      sessionManager.incrementIteration(session.id);
      
      const updatedSession = sessionManager.getSession(session.id);
      expect(updatedSession!.iterationCount).toBe(3);
    });

    it('does nothing when incrementing non-existent session', () => {
      expect(() => {
        sessionManager.incrementIteration('non-existent-id');
      }).not.toThrow();
    });
  });

  describe('listSessions', () => {
    it('lists all sessions', () => {
      const session1Input = {
        taskId: 'test-list-1',
        summary: 'List test session 1'
      };
      
      const session2Input = {
        taskId: 'test-list-2',
        summary: 'List test session 2'
      };

      const session1 = sessionManager.createSession(session1Input);
      const session2 = sessionManager.createSession(session2Input);
      
      const sessions = sessionManager.listSessions();
      
      expect(sessions).toHaveLength(2);
      expect(sessions.some(s => s.id === session1.id)).toBe(true);
      expect(sessions.some(s => s.id === session2.id)).toBe(true);
      expect(sessions.some(s => s.taskId === 'test-list-1')).toBe(true);
      expect(sessions.some(s => s.taskId === 'test-list-2')).toBe(true);
    });

    it('returns empty array when no sessions exist', () => {
      const sessions = sessionManager.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('deletes old sessions based on maxAgeMs', async () => {
      // Create a session with old timestamp
      const oldSessionInput = {
        taskId: 'test-old-session',
        summary: 'Old session'
      };

      const oldSession = sessionManager.createSession(oldSessionInput);
      
      // Manually modify the created timestamp to make it old
      const sessionFilePath = join(mockSessionDir, `${oldSession.id}.json`);
      const sessionData = JSON.parse(await fs.readFile(sessionFilePath, 'utf8'));
      sessionData.createdAt = new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(); // 25 hours ago
      await fs.writeFile(sessionFilePath, JSON.stringify(sessionData, null, 2));
      
      // Reload sessions from disk to get updated timestamps
      sessionManager = new SessionManager(mockSessionDir);
      
      // Create a recent session
      const recentSessionInput = {
        taskId: 'test-recent-session',
        summary: 'Recent session'
      };

      const recentSession = sessionManager.createSession(recentSessionInput);
      
      // Cleanup sessions older than 24 hours
      sessionManager.cleanup(1000 * 60 * 60 * 24); // 24 hours
      
      const sessions = sessionManager.listSessions();
      
      // Old session should be deleted, recent session should remain
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(recentSession.id);
      expect(sessions[0].taskId).toBe('test-recent-session');
    });

    it('does not delete recent sessions', () => {
      const sessionInput = {
        taskId: 'test-recent-session',
        summary: 'Recent session'
      };

      const session = sessionManager.createSession(sessionInput);
      
      // Cleanup sessions older than 1 day (should not delete this session)
      sessionManager.cleanup(1000 * 60 * 60 * 24); // 24 hours
      
      const sessions = sessionManager.listSessions();
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe(session.id);
    });

    it('handles cleanup when no sessions exist', () => {
      expect(() => {
        sessionManager.cleanup(1000 * 60 * 60 * 24); // 24 hours
      }).not.toThrow();
      
      const sessions = sessionManager.listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe('Session directory management', () => {
    it('creates session directory if it does not exist', () => {
      // Use a different temporary directory that doesn't exist
      const newDir = '/tmp/new-test-sessions';
      try {
        fsSync.rmSync(newDir, { recursive: true, force: true });
      } catch (error) {
        // Directory doesn't exist, which is fine
      }
      
      const newManager = new SessionManager(newDir);
      
      // Create a session to trigger directory creation
      const sessionInput = {
        taskId: 'test-dir-creation',
        summary: 'Directory creation test'
      };
      
      expect(() => {
        newManager.createSession(sessionInput);
      }).not.toThrow();
      
      // Verify directory was created
      const dirExists = fsSync.existsSync(newDir);
      expect(dirExists).toBe(true);
      
      // Clean up
      fsSync.rmSync(newDir, { recursive: true, force: true });
    });
  });
});
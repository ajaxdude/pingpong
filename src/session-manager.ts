import { setTimeout } from 'timers/promises';
import * as fs from 'fs';
import * as path from 'path';
import { nanoid } from 'nanoid';
import {
  ReviewSession,
  RequestReviewResult,
  ReviewStatus,
  ReviewerType,
  EscalationReason,
} from './types.js';

// Callback type for session updates
type SessionUpdateCallback = (sessionId: string, session: ReviewSession) => void;

interface SessionData {
  id: string;
  taskId: string;
  status: ReviewStatus;
  summary: string;
  details?: string;
  conversationHistory?: string[];
  llmFeedback?: string;
  humanFeedback?: string;
  escalationReason?: EscalationReason;
  iterationCount: number;
  reviewerType?: ReviewerType;
  agentResolve?: (result: RequestReviewResult) => void;
  createdAt: string;
  updatedAt: string;
}

export class SessionManager {
  private sessionDir: string;
  private sessions: Map<string, SessionData>;
  private sessionUpdateCallbacks: SessionUpdateCallback[] = [];
  private cleanupInterval?: NodeJS.Timeout;

  constructor(sessionDir: string) {
    this.sessionDir = sessionDir;
    this.sessions = new Map();
    this.loadSessions();
  }

  private ensureSessionDirExists(): void {
    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true });
    }
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.sessionDir, `${sessionId}.json`);
  }

  private loadSessions(): void {
    this.ensureSessionDirExists();

    try {
      const files = fs.readdirSync(this.sessionDir);

      for (const file of files) {
        if (!file.endsWith('.json')) {
          continue;
        }

        const filePath = path.join(this.sessionDir, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const sessionData = JSON.parse(content) as SessionData;
          this.sessions.set(sessionData.id, sessionData);
        } catch (err) {
          console.error(`Failed to load session from ${filePath}:`, err);
        }
      }
    } catch (err) {
      console.error(`Failed to read session directory ${this.sessionDir}:`, err);
    }
  }

  private saveSessionToDisk(sessionId: string, sessionData: SessionData): void {
    this.ensureSessionDirExists();

    try {
      const filePath = this.getSessionFilePath(sessionId);
      fs.writeFileSync(filePath, JSON.stringify(sessionData, null, 2), 'utf8');
    } catch (err) {
      console.error(`Failed to save session ${sessionId} to ${this.getSessionFilePath(sessionId)}:`, err);
    }
  }

  saveSession(session: ReviewSession): void {
    const sessionId = session.id;
    const existingSession = this.sessions.get(sessionId);

    const sessionData: SessionData = {
      id: session.id,
      taskId: session.taskId,
      status: session.status,
      summary: session.summary,
      details: session.details,
      conversationHistory: session.conversationHistory,
      llmFeedback: session.llmFeedback,
      humanFeedback: session.humanFeedback,
      escalationReason: session.escalationReason,
      iterationCount: session.iterationCount,
      reviewerType: session.reviewerType,
      agentResolve: session.agentResolve,
      createdAt: existingSession?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(sessionId, sessionData);
    this.saveSessionToDisk(sessionId, sessionData);
  }

  deleteSessionFile(sessionId: string): void {
    try {
      const filePath = this.getSessionFilePath(sessionId);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      this.sessions.delete(sessionId);
    } catch (err) {
      console.error(`Failed to delete session file ${sessionId}:`, err);
    }
  }

  createSession(input: {
    taskId: string;
    summary: string;
    details?: string;
    conversationHistory?: string[];
  }): ReviewSession {
    const sessionId = nanoid();
    const now = new Date().toISOString();

    const sessionData: SessionData = {
      id: sessionId,
      taskId: input.taskId,
      status: 'pending' as ReviewStatus,
      summary: input.summary,
      details: input.details,
      conversationHistory: input.conversationHistory,
      iterationCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(sessionId, sessionData);
    this.saveSessionToDisk(sessionId, sessionData);

    return this.toReviewSession(sessionData);
  }

  getSession(sessionId: string): ReviewSession | null {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      return null;
    }
    return this.toReviewSession(sessionData);
  }

  updateSession(
    sessionId: string,
    updates: {
      status?: ReviewStatus;
      feedback?: string;
      reviewerType?: ReviewerType;
      escalationReason?: EscalationReason;
    },
  ): void {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      return;
    }

    if (updates.status) {
      sessionData.status = updates.status;
    }
    if (updates.reviewerType) {
      sessionData.reviewerType = updates.reviewerType;
    }
    if (updates.escalationReason) {
      sessionData.escalationReason = updates.escalationReason;
    }

    // Update appropriate feedback field based on reviewer type
    if (updates.feedback) {
      if (sessionData.reviewerType === 'human') {
        sessionData.humanFeedback = updates.feedback;
      } else {
        sessionData.llmFeedback = updates.feedback;
      }
    }

    sessionData.updatedAt = new Date().toISOString();
    this.sessions.set(sessionId, sessionData);
    this.saveSessionToDisk(sessionId, sessionData);

    // Trigger callbacks for session updates
    const updatedSession = this.toReviewSession(sessionData);
    this.sessionUpdateCallbacks.forEach(callback => {
      try {
        callback(sessionId, updatedSession);
      } catch (error) {
        console.error('[Session Manager] Error in session update callback:', error);
      }
    });
  }

  incrementIteration(sessionId: string): void {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      return;
    }

    sessionData.iterationCount += 1;
    sessionData.updatedAt = new Date().toISOString();
    this.sessions.set(sessionId, sessionData);
    this.saveSessionToDisk(sessionId, sessionData);
  }

  listSessions(): ReviewSession[] {
    return Array.from(this.sessions.values()).map((data) => this.toReviewSession(data));
  }

  async cleanup(maxAgeMs: number): Promise<void> {
    const cutoff = Date.now() - maxAgeMs;
    const toDelete: string[] = [];

    for (const [sessionId, sessionData] of this.sessions.entries()) {
      const createdAt = new Date(sessionData.createdAt).getTime();
      if (createdAt < cutoff) {
        toDelete.push(sessionId);
      }
    }

    for (const sessionId of toDelete) {
      this.deleteSessionFile(sessionId);
    }
  }

  startCleanupCron(maxAgeMs: number = 86400000): void {
    // Stop any existing cleanup interval
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    // Start new cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup(maxAgeMs).catch(err => {
        console.error('[Session Manager] Cleanup cron failed:', err);
      });
    }, maxAgeMs);

    console.log('[Session Manager] Automatic cleanup cron started');
  }

  stopCleanupCron(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
      console.log('[Session Manager] Automatic cleanup cron stopped');
    }
  }

  setResolveCallback(sessionId: string, callback: (result: RequestReviewResult) => void): void {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      return;
    }

    sessionData.agentResolve = callback;
    this.sessions.set(sessionId, sessionData);
    this.saveSessionToDisk(sessionId, sessionData);
  }

  resolveSession(sessionId: string, feedback: string): void {
    const sessionData = this.sessions.get(sessionId);
    if (!sessionData) {
      return;
    }

    const callback = sessionData.agentResolve;
    if (!callback) {
      return;
    }

    const result: RequestReviewResult = {
      status: sessionData.status,
      feedback,
      sessionId: sessionData.id,
      iterationCount: sessionData.iterationCount,
      reviewerType: sessionData.reviewerType ?? 'llm',
    };

    callback(result);
  }

  private toReviewSession(sessionData: SessionData): ReviewSession {
    const session: ReviewSession = {
      id: sessionData.id,
      taskId: sessionData.taskId,
      status: sessionData.status,
      summary: sessionData.summary,
      details: sessionData.details,
      conversationHistory: sessionData.conversationHistory,
      llmFeedback: sessionData.llmFeedback,
      humanFeedback: sessionData.humanFeedback,
      escalationReason: sessionData.escalationReason,
      iterationCount: sessionData.iterationCount,
      reviewerType: sessionData.reviewerType,
    };
    return session;
  }
}

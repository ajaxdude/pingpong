import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReviewLoop, createReviewLoop } from '../../src/review-loop.js';
import { SessionManager } from '../../src/session-manager.js';
import { PingpongConfig, ReviewStatus } from '../../src/types.js';
import { rm } from 'fs/promises';

// Mock modules
vi.mock('../../src/llm-prompt.js', () => ({
  buildReviewPrompt: vi.fn(),
}));
vi.mock('../../src/llm-client.js', () => ({
  createLLMClient: vi.fn(),
}));
vi.mock('../../src/context-gatherer.js', () => ({
  loadPRD: vi.fn(),
  loadGitDiff: vi.fn(),
  loadAGENTS: vi.fn(),
}));

describe('ReviewLoop', () => {
  let config: PingpongConfig;

  const defaultConfig: PingpongConfig = {
    llm: {
      endpoint: 'http://localhost:11434/api/chat',
      model: 'llama3',
      temperature: 0.2,
      maxTokens: 4096,
      timeout: 30000,
    },
    prd: {
      file: 'PRD.md',
      prompt: null,
      autoDetect: true,
      paths: [],
      fallbackPath: null,
    },
    review: {
      timeout: 60000,
      maxIterations: 3,
      requiredApprovals: 1,
      retryOnLlmError: true,
    },
    escalation: {
      enabled: true,
      timeout: 30000,
      notify: [],
      port: 9876,
      autoOpenBrowser: true,
    },
    gitDiff: {
      enabled: true,
      contextLines: 3,
      maxSizeBytes: 100 * 1024,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    config = { ...defaultConfig };
  });

  describe('startReview', () => {
    it('should create a session and run review loop with approved status', async () => {
      const mockSessionManager = new SessionManager('/tmp/test-sessions-review-1');
      const mockLLMClient = {
        submitReview: vi.fn().mockResolvedValue({ status: 'approved', feedback: 'Code looks good!' }),
      };
      const gatherContext = {
        gather: vi.fn().mockResolvedValue({
          prd: null,
          gitDiff: '',
          agentsContent: null,
          sessionHistory: [],
        }),
      };

      try {
        // Create ReviewLoop instance
        const reviewLoop = new ReviewLoop(
          mockSessionManager,
          config,
          gatherContext,
          mockLLMClient
        );

        // Run review
        const result = await reviewLoop.startReview('task-001', 'Test task', 'Test details');

        // Verify results
        expect(result.status).toBe('approved');
        expect(result.feedback).toBe('Code looks good!');
        expect(result.iterationCount).toBe(1);
        expect(result.reviewerType).toBe('llm');

        // Verify LLM was called once
        expect(mockLLMClient.submitReview).toHaveBeenCalledTimes(1);

        // Verify context gatherer was called
        expect(gatherContext.gather).toHaveBeenCalledWith('task-001', 'Test task', 'Test details');
      } finally {
        // Cleanup
        try {
          await rm('/tmp/test-sessions-review-1', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should handle needs_revision status and continue to next iteration', async () => {
      const mockSessionManager = new SessionManager('/tmp/test-sessions-review-2');
      const mockLLMClient = {
        submitReview: vi.fn()
          .mockResolvedValueOnce({ status: 'needs_revision', feedback: 'Add more tests' })
          .mockResolvedValueOnce({ status: 'approved', feedback: 'Tests added, approved!' }),
      };
      const gatherContext = {
        gather: vi.fn().mockResolvedValue({
          prd: null,
          gitDiff: '',
          agentsContent: null,
          sessionHistory: [],
        }),
      };

      try {
        // Create ReviewLoop instance
        const reviewLoop = new ReviewLoop(
          mockSessionManager,
          config,
          gatherContext,
          mockLLMClient
        );

        // Run review
        const result = await reviewLoop.startReview('task-001', 'Test task', 'Test details');

        // Verify results
        expect(result.status).toBe('approved');
        expect(result.feedback).toBe('Tests added, approved!');
        expect(result.iterationCount).toBe(2);

        // Verify LLM was called twice
        expect(mockLLMClient.submitReview).toHaveBeenCalledTimes(2);

        // Verify context gatherer was called twice
        expect(gatherContext.gather).toHaveBeenCalledTimes(2);
      } finally {
        // Cleanup
        try {
          await rm('/tmp/test-sessions-review-2', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should respect maxIterations and return needs_revision when limit reached', async () => {
      config.review.maxIterations = 2;

      const mockSessionManager = new SessionManager('/tmp/test-sessions-review-3');
      const mockLLMClient = {
        submitReview: vi.fn()
          .mockResolvedValueOnce({ status: 'needs_revision', feedback: 'Fix issue 1' })
          .mockResolvedValueOnce({ status: 'needs_revision', feedback: 'Fix issue 2' }),
      };
      const gatherContext = {
        gather: vi.fn().mockResolvedValue({
          prd: null,
          gitDiff: '',
          agentsContent: null,
          sessionHistory: [],
        }),
      };

      try {
        // Create ReviewLoop instance
        const reviewLoop = new ReviewLoop(
          mockSessionManager,
          config,
          gatherContext,
          mockLLMClient
        );

        // Run review
        const result = await reviewLoop.startReview('task-001', 'Test task', 'Test details');

        // Verify results
        expect(result.status).toBe('needs_revision');
        expect(result.feedback).toBe('Fix issue 2');
        expect(result.iterationCount).toBe(2);

        // Verify LLM was called maxIterations times
        expect(mockLLMClient.submitReview).toHaveBeenCalledTimes(2);

        // Verify context gatherer was called maxIterations times
        expect(gatherContext.gather).toHaveBeenCalledTimes(2);
      } finally {
        // Cleanup
        try {
          await rm('/tmp/test-sessions-review-3', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should escalate when LLM returns null response', async () => {
      const mockSessionManager = new SessionManager('/tmp/test-sessions-review-4');
      const mockLLMClient = {
        submitReview: vi.fn().mockResolvedValueOnce(null),
      };
      const gatherContext = {
        gather: vi.fn().mockResolvedValue({
          prd: null,
          gitDiff: '',
          agentsContent: null,
          sessionHistory: [],
        }),
      };

      try {
        // Create ReviewLoop instance
        const reviewLoop = new ReviewLoop(
          mockSessionManager,
          config,
          gatherContext,
          mockLLMClient
        );

        // Run review
        const result = await reviewLoop.startReview('task-001', 'Test task', 'Test details');

        // Verify results
        expect(result.status).toBe('escalated');
        expect(result.feedback).toBe('Failed to get LLM response');
        expect(result.iterationCount).toBe(1);

        // Verify LLM was called once
        expect(mockLLMClient.submitReview).toHaveBeenCalledTimes(1);
      } finally {
        // Cleanup
        try {
          await rm('/tmp/test-sessions-review-4', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should stop on approved status without additional iterations', async () => {
      config.review.maxIterations = 5;

      const mockSessionManager = new SessionManager('/tmp/test-sessions-review-5');
      const mockLLMClient = {
        submitReview: vi.fn().mockResolvedValueOnce({ status: 'approved', feedback: 'Approved!' }),
      };
      const gatherContext = {
        gather: vi.fn().mockResolvedValue({
          prd: null,
          gitDiff: '',
          agentsContent: null,
          sessionHistory: [],
        }),
      };

      try {
        // Create ReviewLoop instance
        const reviewLoop = new ReviewLoop(
          mockSessionManager,
          config,
          gatherContext,
          mockLLMClient
        );

        // Run review
        const result = await reviewLoop.startReview('task-001', 'Test task', 'Test details');

        // Verify results
        expect(result.status).toBe('approved');
        expect(result.iterationCount).toBe(1);

        // Verify LLM was called only once (stopped after approved)
        expect(mockLLMClient.submitReview).toHaveBeenCalledTimes(1);

        // Verify context gatherer was called only once
        expect(gatherContext.gather).toHaveBeenCalledTimes(1);
      } finally {
        // Cleanup
        try {
          await rm('/tmp/test-sessions-review-5', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should stop on escalated status without additional iterations', async () => {
      config.review.maxIterations = 5;

      const mockSessionManager = new SessionManager('/tmp/test-sessions-review-6');
      const mockLLMClient = {
        submitReview: vi.fn().mockResolvedValueOnce({ status: 'escalated', feedback: 'Requires human review' }),
      };
      const gatherContext = {
        gather: vi.fn().mockResolvedValue({
          prd: null,
          gitDiff: '',
          agentsContent: null,
          sessionHistory: [],
        }),
      };

      try {
        // Create ReviewLoop instance
        const reviewLoop = new ReviewLoop(
          mockSessionManager,
          config,
          gatherContext,
          mockLLMClient
        );

        // Run review
        const result = await reviewLoop.startReview('task-001', 'Test task', 'Test details');

        // Verify results
        expect(result.status).toBe('escalated');
        expect(result.iterationCount).toBe(1);

        // Verify LLM was called only once (stopped after escalated)
        expect(mockLLMClient.submitReview).toHaveBeenCalledTimes(1);

        // Verify context gatherer was called only once
        expect(gatherContext.gather).toHaveBeenCalledTimes(1);
      } finally {
        // Cleanup
        try {
          await rm('/tmp/test-sessions-review-6', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should build correct prompt with all context', async () => {
      vi.mocked((await import('../../src/llm-prompt.js')).buildReviewPrompt).mockReturnValue('prompt');

      const gatherContext = {
        gather: vi.fn().mockResolvedValue({
          prd: '# PRD\nTest PRD content',
          gitDiff: 'diff --git file.txt',
          agentsContent: '// AGENTS\nAgent contract',
          sessionHistory: [],
        }),
      };

      const mockLLMClient = {
        submitReview: vi.fn().mockResolvedValue({ status: 'approved', feedback: 'Approved!' }),
      };

      const mockSessionManager = new SessionManager('/tmp/test-sessions-review-7');

      try {
        // Create ReviewLoop instance
        const reviewLoop = new ReviewLoop(
          mockSessionManager,
          config,
          gatherContext,
          mockLLMClient
        );

        // Run review
        await reviewLoop.startReview('task-001', 'Test task', 'Test details');

        // Verify context gatherer was called
        expect(gatherContext.gather).toHaveBeenCalledWith('task-001', 'Test task', 'Test details');

        // Verify prompt was built with all context
        const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
        expect(buildReviewPrompt).toHaveBeenCalled();
        
        const callArgs = buildReviewPrompt.mock.calls[0];
        expect(callArgs[0]).toBe('# PRD\nTest PRD content'); // prd
        expect(callArgs[1]).toBe('diff --git file.txt'); // gitDiff
        expect(callArgs[2]).toBe('// AGENTS\nAgent contract'); // agentsContent
      } finally {
        // Cleanup
        try {
          await rm('/tmp/test-sessions-review-7', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should build correct prompt with session history after first iteration', async () => {
      const buildReviewPromptMock = vi.fn()
        .mockReturnValueOnce('prompt1')
        .mockReturnValueOnce('prompt2');
      
      vi.mocked((await import('../../src/llm-prompt.js')).buildReviewPrompt).mockImplementation((...args: any[]) => buildReviewPromptMock(...args));

      const gatherContext = {
        gather: vi.fn().mockResolvedValue({
          prd: null,
          gitDiff: '',
          agentsContent: null,
          sessionHistory: [],
        }),
      };

      const mockLLMClient = {
        submitReview: vi.fn()
          .mockResolvedValueOnce({ status: 'needs_revision', feedback: 'Fix issue' })
          .mockResolvedValueOnce({ status: 'approved', feedback: 'Approved!' }),
      };

      const mockSessionManager = new SessionManager('/tmp/test-sessions-review-8');

      try {
        // Create ReviewLoop instance
        const reviewLoop = new ReviewLoop(
          mockSessionManager,
          config,
          gatherContext,
          mockLLMClient
        );
        
        // Run review (2 iterations)
        await reviewLoop.startReview('task-001', 'Test task', 'Test details');
        
        // Verify prompt was built twice
        const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
        expect(buildReviewPrompt).toHaveBeenCalledTimes(2);
        
        // First call should have empty session history
        const firstCall = buildReviewPrompt.mock.calls[0];
        expect(firstCall[3]).toBeUndefined(); // sessionHistory
        // Second call should have session history from first iteration
        const secondCall = buildReviewPrompt.mock.calls[1];
        expect(secondCall[3]).toBeDefined();
        // Session history should contain iteration 1 data
        expect(Array.isArray(secondCall[3])).toBe(true);
        expect(secondCall[3]?.length).toBeGreaterThan(0);
      } finally {
        // Cleanup
        try {
          await rm('/tmp/test-sessions-review-8', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });

  describe('createReviewLoop', () => {
    it('should create a ReviewLoop with default context gatherer', async () => {
      vi.mocked((await import('../../src/llm-client.js')).createLLMClient).mockReturnValue({
        submitReview: vi.fn().mockResolvedValue({ status: 'approved', feedback: 'test' }),
      });
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(null);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue('');
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const mockSessionDir = '/tmp/test-sessions-review-9';
      
      try {
        const sessionManager = new SessionManager(mockSessionDir);
        const reviewLoop = createReviewLoop(sessionManager, config);

        expect(reviewLoop).toBeInstanceOf(ReviewLoop);
      } finally {
        // Cleanup
        try {
          await rm('/tmp/test-sessions-review-9', { recursive: true, force: true });
        } catch {
          // Ignore cleanup errors
        }
      }
    });
  });
});

import { SessionManager } from './session-manager.js';
import { createLLMClient } from './llm-client.js';
import { buildReviewPrompt } from './llm-prompt.js';
import { loadPRD, loadGitDiff, loadAGENTS } from './context-gatherer.js';
import { PingpongConfig, RequestReviewResult, ReviewStatus } from './types.js';

/**
 * Context gatherer interface for collecting review context
 */
interface ContextGatherer {
  gather(taskId: string, summary: string, details?: string): Promise<{
    prd: string | null;
    gitDiff: string;
    agentsContent: string | null;
    sessionHistory: string[];
  }>;
}

/**
 * LLM client interface for submitting reviews
 */
interface LLMApiClient {
  submitReview(prompt: string): Promise<{ status: string; feedback: string } | null>;
}

/**
 * Review loop configuration
 */
interface ReviewLoopConfig {
  maxIterations: number;
}

/**
 * Result returned after review loop completes
 */
interface ReviewResult {
  status: ReviewStatus;
  feedback: string;
  sessionId: string;
  iterationCount: number;
  reviewerType: 'llm' | 'human';
}

/**
 * Main review loop orchestrator
 */
export class ReviewLoop {
  private sessionManager: SessionManager;
  private llmClient: LLMApiClient;
  private contextGatherer: ContextGatherer;
  private config: ReviewLoopConfig;

  constructor(
    sessionManager: SessionManager,
    config: PingpongConfig,
    contextGatherer: ContextGatherer,
    llmClient: LLMApiClient
  ) {
    this.sessionManager = sessionManager;
    this.llmClient = llmClient;
    this.contextGatherer = contextGatherer;
    this.config = {
      maxIterations: config.review.maxIterations,
    };
  }

  /**
   * Main review entry point
   */
  async startReview(
    taskId: string,
    summary: string,
    details?: string,
    conversationHistory?: string[]
  ): Promise<ReviewResult> {
    // Create session
    const session = this.sessionManager.createSession({
      taskId,
      summary,
      details,
      conversationHistory,
    });

    let iterationCount = 0;
    let status: ReviewStatus = 'pending';
    let feedback = '';
    const sessionHistory: string[] = [];

    // Main iteration loop
    while (iterationCount < this.config.maxIterations) {
      iterationCount++;

      // Gather context
      const context = await this.contextGatherer.gather(taskId, summary, details);

      // Build prompt
      const prompt = buildReviewPrompt(
        context.prd,
        context.gitDiff,
        context.agentsContent,
        sessionHistory.length > 0 ? sessionHistory : undefined,
        taskId,
        summary,
        details
      );

      // Call LLM
      const llmResponse = await this.llmClient.submitReview(prompt);

      if (!llmResponse) {
        status = 'escalated';
        feedback = 'Failed to get LLM response';

        // Update session with escalation status
        this.sessionManager.updateSession(session.id, {
          status,
          feedback,
          reviewerType: 'llm',
        });

        break;
      }

      status = llmResponse.status as ReviewStatus;
      feedback = llmResponse.feedback;

      // Update session
      this.sessionManager.updateSession(session.id, {
        status,
        feedback,
        reviewerType: 'llm',
      });

      // Track iteration in history
      sessionHistory.push(
        `Iteration ${iterationCount}:\nStatus: ${status}\nFeedback: ${feedback}`
      );

      // Stop if approved or escalated
      if (status === 'approved' || status === 'escalated') {
        break;
      }

      // Increment iteration counter in session
      this.sessionManager.incrementIteration(session.id);
    }

    return {
      status,
      feedback,
      sessionId: session.id,
      iterationCount,
      reviewerType: 'llm',
    };
  }
}

/**
 * Factory function to create a ReviewLoop instance
 */
export function createReviewLoop(sessionManager: SessionManager, config: PingpongConfig): ReviewLoop {
  const contextGatherer: ContextGatherer = {
    async gather(taskId: string, summary: string, details?: string) {
      return {
        prd: loadPRD(),
        gitDiff: loadGitDiff(),
        agentsContent: loadAGENTS(),
        sessionHistory: [],
      };
    },
  };

  const llmClient = createLLMClient(config);

  return new ReviewLoop(sessionManager, config, contextGatherer, llmClient);
}

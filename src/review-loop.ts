import { SessionManager } from './session-manager.js';
import { createLLMClient, LLMClientError, LLMClientResult } from './llm-client.js';
import { buildReviewPrompt } from './llm-prompt.js';
import { loadPRD, loadGitDiff, loadAGENTS } from './context-gatherer.js';
import { modelRouter, updateRouteEventEffectiveness } from './router.js';
import { PingpongConfig, RequestReviewResult, ReviewStatus, EscalationReason } from './types.js';

/** Maximum model rotation attempts per review pass (guards against infinite retry). */
const MAX_MODEL_ROTATIONS = 3;

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
  submitReview(prompt: string): Promise<LLMClientResult>;
}

/**
 * Minimal config slice the loop itself needs.
 */
interface ReviewLoopConfig {
  maxIterations: number;
}

/**
 * Result returned after review loop completes.
 * escalationReason is set when status === 'escalated'.
 */
export interface ReviewResult {
  status: ReviewStatus;
  feedback: string;
  sessionId: string;
  iterationCount: number;
  reviewerType: 'llm' | 'human';
  escalationReason?: EscalationReason;
}

/**
 * Main review loop orchestrator.
 *
 * Feature 1 – automated LLM code review: iterates up to maxIterations,
 * sending the prompt to a local LLM and acting on the structured response.
 *
 * Feature 2 – model routing: when config.router.enabled, selects the
 * most cost-effective model for each review via modelRouter before
 * constructing the LLM client. Each routing decision is recorded and
 * its effectiveness updated once the review outcome is known.
 *
 * Feature 3 – model rotation on failure: when an LLM call fails due to
 * a transient error (connection_failed, timeout), the loop tries the next
 * available model (up to MAX_MODEL_ROTATIONS attempts) before escalating.
 * This does not count as an iteration against maxIterations.
 */
export class ReviewLoop {
  private sessionManager: SessionManager;
  private contextGatherer: ContextGatherer;
  private config: ReviewLoopConfig;
  private pingpongConfig: PingpongConfig;
  // Optional fixed client — used by tests to inject a mock without needing
  // a router or a real LLM endpoint.
  private fixedLLMClient: LLMApiClient | null;

  constructor(
    sessionManager: SessionManager,
    config: PingpongConfig,
    contextGatherer: ContextGatherer,
    // Optional: supply a pre-built client to bypass router selection.
    // Tests use this to inject mocks; production leaves it undefined.
    fixedLLMClient?: LLMApiClient
  ) {
    this.sessionManager = sessionManager;
    this.contextGatherer = contextGatherer;
    this.config = { maxIterations: config.review.maxIterations };
    this.pingpongConfig = config;
    this.fixedLLMClient = fixedLLMClient ?? null;
  }

  /**
   * Create an LLM client for a single review pass.
   *
   * Returns the client, the routing event id (if routing ran), and the
   * selected model name so the caller can track failures for rotation.
   *
   * Priority:
   *   1. fixedLLMClient — injected by tests or callers that already resolved the model
   *   2. selectModelExcluding — when excludedModels is non-empty (rotation mode)
   *   3. selectModel — normal routing (uses cache)
   *   4. default configured model — fallback for all other cases
   */
  private async createLLMClientForReview(
    prompt: string,
    excludedModels?: Set<string>
  ): Promise<{ client: LLMApiClient; routeEventId: string | null; selectedModel: string }> {
    if (this.fixedLLMClient) {
      return { client: this.fixedLLMClient, routeEventId: null, selectedModel: this.pingpongConfig.llm.model };
    }

    if (this.pingpongConfig.router?.enabled) {
      // Rotation mode: excludedModels has entries from previous failures
      if (excludedModels && excludedModels.size > 0) {
        try {
          const selection = await modelRouter.selectModelExcluding(prompt, Array.from(excludedModels));
          if (selection) {
            const client = createLLMClient({
              ...this.pingpongConfig,
              llm: { ...this.pingpongConfig.llm, model: selection.model },
            });
            return { client, routeEventId: selection.eventId, selectedModel: selection.model };
          }
          // null → no non-excluded models available; fall through to default
        } catch (err) {
          console.warn(`[WARN] Model rotation selection failed: ${err}`);
        }
      } else {
        // Normal routing — uses cache
        try {
          const selection = await modelRouter.selectModel(prompt);
          console.error(
            `[INFO] Router selected model: ${selection.model}` +
            ` (cached: ${selection.cached}, latency: ${selection.latencyMs}ms)`
          );
          const client = createLLMClient({
            ...this.pingpongConfig,
            llm: { ...this.pingpongConfig.llm, model: selection.model },
          });
          return { client, routeEventId: selection.eventId, selectedModel: selection.model };
        } catch (err) {
          // Router failure must never block reviews — fall through to default.
          console.warn(`[WARN] Model router failed, using default model: ${err}`);
        }
      }
    }

    // Use discovered model name when available — avoids sending sentinel
    // values like "default" or "best" that llama-swap won't recognize.
    const discoveredModel = modelRouter.getBestModel();
    const effectiveModel = discoveredModel ?? this.pingpongConfig.llm.model;
    return {
      client: createLLMClient({
        ...this.pingpongConfig,
        llm: { ...this.pingpongConfig.llm, model: effectiveModel },
      }),
      routeEventId: null,
      selectedModel: effectiveModel,
    };
  }

  /**
   * Run the review loop against an existing session by ID.
   *
   * Both public entry points delegate here so there is exactly one code
   * path that touches the session — and both callers share the same session
   * that appears in the dashboard and is returned to the agent.
   */
  private async runLoop(
    sessionId: string,
    taskId: string,
    summary: string,
    details?: string
  ): Promise<ReviewResult> {
    const existingSession = this.sessionManager.getSession(sessionId);
    if (!existingSession) {
      throw new Error(`[ReviewLoop] Session ${sessionId} not found`);
    }

    let iterationCount = 0;
    let status: ReviewStatus = 'pending';
    let feedback = '';
    let escalationReason: EscalationReason | undefined;
    const sessionHistory: string[] = [];
    // Models that failed with a transient error in this review run
    const failedModels = new Set<string>();

    while (iterationCount < this.config.maxIterations) {
      iterationCount++;

      const context = await this.contextGatherer.gather(taskId, summary, details);

      const prompt = buildReviewPrompt(
        context.prd,
        context.gitDiff,
        context.agentsContent,
        sessionHistory.length > 0 ? sessionHistory : undefined,
        taskId,
        summary,
        details
      );

      // Select model — rotation mode if we have prior failures this run
      const { client: llmClient, routeEventId, selectedModel } =
        await this.createLLMClientForReview(prompt, failedModels);

      const llmResponse = await llmClient.submitReview(prompt);

      if (!llmResponse || 'type' in llmResponse) {
        // null response treated as a parse error
        const error = llmResponse as LLMClientError | null;
        const isTransient = !!error && (error.type === 'connection_failed' || error.type === 'timeout');

        // Attempt model rotation for transient errors when routing is enabled
        if (
          isTransient &&
          !this.fixedLLMClient && // Don't rotate when using an injected fixed client (tests)
          this.pingpongConfig.router?.enabled &&
          failedModels.size < MAX_MODEL_ROTATIONS
        ) {
          failedModels.add(selectedModel);
          console.error(
            `[INFO] Model ${selectedModel} failed (${error!.type}), ` +
            `attempting rotation (${failedModels.size}/${MAX_MODEL_ROTATIONS})`
          );
          if (routeEventId) updateRouteEventEffectiveness(routeEventId, 'escalated');
          // Do not count this as a review iteration
          iterationCount--;
          continue;
        }

        // No rotation available, non-transient error, or null response — escalate
        status = 'escalated';
        escalationReason = error?.type === 'connection_failed' ? 'connection_failed' : 'llm_error';
        feedback = !error
          ? 'Failed to get LLM response'
          : error.type === 'connection_failed'
          ? error.message
          : `LLM error: ${error.message}`;

        this.sessionManager.updateSession(sessionId, {
          status,
          feedback,
          reviewerType: 'llm',
          escalationReason,
        });
        if (routeEventId) updateRouteEventEffectiveness(routeEventId, 'escalated');
        break;
      }

      // Successful LLM response — reset rotation state
      failedModels.clear();

      status = llmResponse.status as ReviewStatus;
      feedback = llmResponse.feedback;

      // Record routing effectiveness
      if (routeEventId) {
        const eff = (status === 'approved' || status === 'needs_revision' || status === 'escalated')
          ? status
          : 'unknown';
        updateRouteEventEffectiveness(routeEventId, eff as any);
      }

      this.sessionManager.updateSession(sessionId, {
        status,
        feedback,
        reviewerType: 'llm',
      });

      sessionHistory.push(
        `Iteration ${iterationCount}:\nStatus: ${status}\nFeedback: ${feedback}`
      );

      if (status === 'approved' || status === 'escalated') {
        break;
      }

      this.sessionManager.incrementIteration(sessionId);
    }

    return {
      status,
      feedback,
      sessionId,
      iterationCount,
      reviewerType: 'llm',
      escalationReason,
    };
  }

  /**
   * Create a new session and run the review loop.
   * Used by callers that do not have an existing session (e.g. legacy callers, tests).
   */
  async startReview(
    taskId: string,
    summary: string,
    details?: string,
    conversationHistory?: string[]
  ): Promise<ReviewResult> {
    const session = this.sessionManager.createSession({
      taskId,
      summary,
      details,
      conversationHistory,
    });
    return this.runLoop(session.id, taskId, summary, details);
  }

  /**
   * Run the review loop against a session that was already created by the
   * caller.  The MCP handler uses this so there is exactly ONE session per
   * request_review call — the same ID the agent receives is the one that
   * gets updated as the review progresses.
   */
  async startReviewOnSession(
    sessionId: string,
    taskId: string,
    summary: string,
    details?: string,
    conversationHistory?: string[]
  ): Promise<ReviewResult> {
    return this.runLoop(sessionId, taskId, summary, details);
  }
}

/**
 * Factory function to create a ReviewLoop with production context gatherers.
 */
export function createReviewLoop(sessionManager: SessionManager, config: PingpongConfig): ReviewLoop {
  const contextGatherer: ContextGatherer = {
    async gather(_taskId: string, _summary: string, _details?: string) {
      return {
        prd: loadPRD(),
        gitDiff: loadGitDiff(),
        agentsContent: loadAGENTS(),
        sessionHistory: [],
      };
    },
  };

  return new ReviewLoop(sessionManager, config, contextGatherer);
}

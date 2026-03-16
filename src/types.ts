// Review status enum values
export type ReviewStatus = 'pending' | 'approved' | 'needs_revision' | 'escalated';

// Reviewer type enum values
export type ReviewerType = 'llm' | 'human';

// Input for requesting a review
export interface RequestReviewInput {
  taskId: string;
  summary: string;
  details?: string;
  conversationHistory?: string[];
}

// Result returned after review request is processed
export interface RequestReviewResult {
  status: ReviewStatus;
  feedback: string;
  sessionId: string;
  iterationCount: number;
  reviewerType: ReviewerType;
}

// Review session tracking all fields from the plan
export interface ReviewSession {
  id: string;
  taskId: string;
  status: ReviewStatus;
  summary: string;
  details?: string;
  conversationHistory?: string[];
  llmFeedback?: string;
  humanFeedback?: string;
  escalationReason?: string;
  iterationCount: number;
  reviewerType?: ReviewerType;
  agentResolve?: (result: RequestReviewResult) => void;
}

// Pingpong configuration
export interface PingpongConfig {
  llm: {
    endpoint: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
    timeout: number;
  };
  prd: {
    file: string;
    prompt?: string;
    autoDetect: boolean;
    paths: string[];
    fallbackPath: string | null;
  };
  review: {
    timeout?: number;
    maxIterations: number;
    requiredApprovals?: number;
    retryOnLlmError: boolean;
  };
  escalation: {
    enabled: boolean;
    timeout?: number;
    notify?: string[];
    port: number;
    autoOpenBrowser: boolean;
  };
  gitDiff: {
    enabled: boolean;
    contextLines?: number;
    maxSizeBytes: number;
  };
}


// LLM API request structure
export interface LLMRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

// LLM API response structure
export interface LLMResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
}

// API session response for HTTP API
export interface APISession {
  id: string;
  taskId: string;
  status: ReviewStatus;
  summary: string;
  details?: string;
  llmFeedback?: string;
  humanFeedback?: string;
  escalationReason?: string;
  iterationCount: number;
  reviewerType?: ReviewerType;
  createdAt: string;
  updatedAt: string;
}

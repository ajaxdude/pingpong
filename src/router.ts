import { createHash } from 'crypto';
import type { PingpongConfig } from './types.js';
import { DEFAULT_CONFIG } from './config.js';

const CLASSIFIER_SYSTEM_PROMPT = `You are a model routing assistant. You will receive a user request and a list of available LLM model IDs. Select the single most appropriate model ID for the task. Rules:
- Prefer local/small models for: simple edits, one-liners, boilerplate, completions, renaming, formatting
- Prefer fast cloud models (gemini-flash, haiku, grok-fast) for: moderate refactoring, bug fixes, single-file changes
- Prefer large frontier models (qwen3-coder-480b, claude-sonnet, gemini-pro) for: architecture, complex bugs, multi-file reasoning
- Prefer thinking/reasoning models for: deep planning, algorithm design, security analysis
- Use anthropic/claude-opus-4 ONLY for: system architecture design, complex multi-system planning, deep security analysis, or when the user explicitly asks for the most capable model. Never for coding tasks, bug fixes, refactoring, or anything with a clear implementation path.
Reply with ONLY the exact model ID string from the list. Nothing else.`;

export interface ModelSelectionResult {
  model: string;
  cached: boolean;
  latencyMs: number;
}

/**
 * A single routing decision event, recorded on every selectModel() call.
 * effectiveness is set later by the review loop once the review outcome
 * is known: 'approved' | 'needs_revision' | 'escalated' | 'unknown'.
 */
export interface RouteEvent {
  id: string;
  timestamp: string;            // ISO-8601
  promptExcerpt: string;        // first 200 chars of the prompt
  selectedModel: string;
  latencyMs: number;
  cached: boolean;
  fallback: boolean;            // true when the router fell back to fallbackModel
  effectiveness: 'approved' | 'needs_revision' | 'escalated' | 'unknown';
}

// In-memory circular buffer — keeps last MAX_EVENTS entries.
const MAX_EVENTS = 500;
const routeEvents: RouteEvent[] = [];

let eventCounter = 0;

/** Append an event. Called by the router on every selectModel() call. */
export function recordRouteEvent(
  event: Omit<RouteEvent, 'id'>
): RouteEvent {
  const full: RouteEvent = { id: String(++eventCounter), ...event };
  routeEvents.push(full);
  if (routeEvents.length > MAX_EVENTS) routeEvents.shift();
  return full;
}

/**
 * Update the effectiveness of a previously recorded event once the
 * review outcome is known. No-op if the event id is not found.
 */
export function updateRouteEventEffectiveness(
  eventId: string,
  effectiveness: RouteEvent['effectiveness']
): void {
  const ev = routeEvents.find(e => e.id === eventId);
  if (ev) ev.effectiveness = effectiveness;
}

/** Return a snapshot of recent events, newest first. */
export function getRouteEvents(): RouteEvent[] {
  return routeEvents.slice().reverse();
}

function findBestCodeModel(models: string[]): string | null {
  if (!models || models.length === 0) {
    return null;
  }

  const preferences = [
    /codereviewer/i,
    /coder/i,
    /codellama/i,
    /gemma/i,
    /llama/i,
    /mistral/i,
    /mixtral/i,
  ];

  for (const pref of preferences) {
    const found = models.find(m => pref.test(m));
    if (found) {
      return found;
    }
  }

  return models[0];
}

class ModelRouter {
  private modelList: string[] = [];
  private cache: Map<string, string>;
  private config: PingpongConfig;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(config: PingpongConfig) {
    this.config = config;
    this.cache = new Map();
    // Always do an initial model discovery so we have a valid model name
    // even when the classifier router is disabled.
    this.refreshModelList();
    if (this.config.router.enabled) {
      this.startRefreshInterval();
    }
  }

  updateConfig(config: PingpongConfig) {
    this.config = config;
    if (this.config.router.enabled) {
      this.startRefreshInterval();
    } else if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  async initialize(): Promise<void> {
    await this.refreshModelList();
    this.startRefreshInterval();
  }

  async refreshModelList(): Promise<void> {
    try {
      // Derive the models URL from the LLM endpoint host — works for both
      // llama-swap (port 8080) and litellm proxies (port 4000).
      const llmUrl = new URL(this.config.llm.endpoint);
      const modelsUrl = `${llmUrl.protocol}//${llmUrl.host}/v1/models`;
      const response = await fetch(modelsUrl, {
        headers: { Authorization: `Bearer ${this.config.router.litellmApiKey}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) {
        console.warn(`[Router] Model list fetch returned ${response.status}`);
        return;
      }
      const data = await response.json();
      const ids: string[] = (data.data ?? []).map((m: any) => m.id);
      if (ids.length > 0) {
        this.modelList = ids;
        console.error(`[Router] Discovered models: ${ids.join(', ')}`);
      }
    } catch (error) {
      console.warn('Failed to refresh model list:', error);
    }
  }

  /** Return the best available code-review model, or null if none discovered yet. */
  getBestModel(): string | null {
    return findBestCodeModel(this.modelList);
  }

  private startRefreshInterval(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.refreshInterval = setInterval(
      () => this.refreshModelList(),
      this.config.router.modelListRefreshSeconds * 1000
    );
  }

  private getPromptHash(prompt: string): string {
    return createHash('sha256')
      .update(prompt.substring(0, 500))
      .digest('hex');
  }

  async selectModel(prompt: string): Promise<ModelSelectionResult & { eventId: string }> {
    const startTime = Date.now();
    const promptHash = this.getPromptHash(prompt);
    const cachedModel = this.cache.get(promptHash);

    if (cachedModel) {
      const ev = recordRouteEvent({
        timestamp: new Date().toISOString(),
        promptExcerpt: prompt.substring(0, 200),
        selectedModel: cachedModel,
        latencyMs: Date.now() - startTime,
        cached: true,
        fallback: false,
        effectiveness: 'unknown',
      });
      return { model: cachedModel, cached: true, latencyMs: Date.now() - startTime, eventId: ev.id };
    }

        try {
      const response = await fetch(
        this.config.router.classifierUrl,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: findBestCodeModel(this.modelList) ?? this.config.llm.model,
            n_gpu_layers: 0, // Force CPU for this small, stability-critical task
            messages: [
              {
                role: 'system',
                content: CLASSIFIER_SYSTEM_PROMPT,
              },
              {
                role: 'user',
                content: `Available models: ${this.modelList.join(', ')}

User prompt: ${prompt}`,
              },
            ],
            max_tokens: 40,
            temperature: 0,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Classifier API error: ${response.status}`);
      }

      const data = await response.json();
      const selectedModel = data.choices[0].message.content.trim();
      if (this.modelList.includes(selectedModel)) {
        this.cache.set(promptHash, selectedModel);
        const ev = recordRouteEvent({
          timestamp: new Date().toISOString(),
          promptExcerpt: prompt.substring(0, 200),
          selectedModel,
          latencyMs: Date.now() - startTime,
          cached: false,
          fallback: false,
          effectiveness: 'unknown',
        });
        return { model: selectedModel, cached: false, latencyMs: Date.now() - startTime, eventId: ev.id };
      }
    } catch (error) {
      console.warn('Model classifier failed, using smart fallback:', error);
    }

    // Fallback path
    const latencyMs = Date.now() - startTime;
    const fallbackModel = findBestCodeModel(this.modelList) ?? this.config.router.fallbackModel;
    const ev = recordRouteEvent({
      timestamp: new Date().toISOString(),
      promptExcerpt: prompt.substring(0, 200),
      selectedModel: fallbackModel,
      latencyMs,
      cached: false,
      fallback: true,
      effectiveness: 'unknown',
    });
    return { model: fallbackModel, cached: false, latencyMs, eventId: ev.id };
  }

  /**
   * Select a model from the available list, excluding the given set.
   * Used for model rotation after a failure.
   * Returns null if no non-excluded models are available.
   * Falls back to first available model if classifier call fails
   * (e.g. because the same llama.cpp endpoint that failed is the classifier).
   */
  async selectModelExcluding(
    prompt: string,
    excluded: string[]
  ): Promise<(ModelSelectionResult & { eventId: string }) | null> {
    const available = this.modelList.filter(m => !excluded.includes(m));
    if (!available.length) return null;

    const startTime = Date.now();

    // Try classifier with the filtered model list
    try {
      const response = await fetch(this.config.router.classifierUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: findBestCodeModel(available) ?? this.config.llm.model,
          n_gpu_layers: 0, // Force CPU — same stability fix as primary selectModel
          messages: [
            { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Available models: ${available.join(', ')}\n\nUser prompt: ${prompt}`,
            },
          ],
          max_tokens: 40,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`Classifier API error: ${response.status}`);
      }
      const data = await response.json();
      const selected = data.choices[0].message.content.trim();
      if (available.includes(selected)) {
        const latencyMs = Date.now() - startTime;
        const ev = recordRouteEvent({
          timestamp: new Date().toISOString(),
          promptExcerpt: prompt.substring(0, 200),
          selectedModel: selected,
          latencyMs,
          cached: false,
          fallback: false,
          effectiveness: 'unknown',
        });
        return { model: selected, cached: false, latencyMs, eventId: ev.id };
      }
    } catch {
      // Classifier unavailable — fall through to first available
    }

    // Fallback: first non-excluded available model
    const chosen = available[0];
    const latencyMs = Date.now() - startTime;
    const ev = recordRouteEvent({
      timestamp: new Date().toISOString(),
      promptExcerpt: prompt.substring(0, 200),
      selectedModel: chosen,
      latencyMs,
      cached: false,
      fallback: true,
      effectiveness: 'unknown',
    });
    return { model: chosen, cached: false, latencyMs, eventId: ev.id };
  }
}

// The global singleton will be initialized later with the loaded config.
export let modelRouter: ModelRouter = new ModelRouter(DEFAULT_CONFIG);

export function initializeModelRouter(config: PingpongConfig) {
  modelRouter = new ModelRouter(config);
}

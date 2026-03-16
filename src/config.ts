import fs from 'fs/promises';
import type { PingpongConfig } from './types.js';

export const DEFAULT_CONFIG: PingpongConfig = {
  llm: {
    endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    model: 'default',
    timeout: 1800,
  },
  prd: {
    file: './docs/PRD.md',
    autoDetect: true,
    paths: ['./docs/PRD.md', './PRD.md', './README.md'],
    fallbackPath: null,
  },
  review: {
    maxIterations: 5,
    retryOnLlmError: true,
  },
  escalation: {
    enabled: true,
    port: 3456,
    autoOpenBrowser: true,
  },
  gitDiff: {
    enabled: true,
    maxSizeBytes: 100 * 1024, // 100KB
  },
};

export async function loadConfig(projectRoot: string): Promise<PingpongConfig> {
  const configPath = `${projectRoot}/pingpong.config.json`;
  let config: PingpongConfig = { ...DEFAULT_CONFIG };

  try {
    const fileContent = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(fileContent);

    // Merge user config deeply
    config = deepMergeConfig(config, userConfig);
  } catch (error) {
    // Config file doesn't exist or is invalid JSON, use defaults
  }

  // Apply environment variable overrides
  config = applyEnvOverrides(config);

  return validateConfig(config);
}

export function validateConfig(config: PingpongConfig): PingpongConfig {
  // Validate LLM timeout
  if (config.llm.timeout <= 0) {
    console.warn(`[WARN] Invalid timeout: ${config.llm.timeout}, using default 1800`);
    config.llm.timeout = 1800;
  }

  // Validate escalation port
  if (config.escalation.port < 1024 || config.escalation.port > 65535) {
    console.warn(`[WARN] Invalid port: ${config.escalation.port}, using default 3456`);
    config.escalation.port = 3456;
  }

  // Validate LLM endpoint URL
  try {
    new URL(config.llm.endpoint);
  } catch {
    console.warn(`[WARN] Invalid endpoint URL: ${config.llm.endpoint}, using default`);
    config.llm.endpoint = DEFAULT_CONFIG.llm.endpoint;
  }

  // Validate maxIterations
  if (config.review.maxIterations < 1) {
    console.warn(`[WARN] Invalid maxIterations: ${config.review.maxIterations}, using default 5`);
    config.review.maxIterations = 5;
  }

  return config;
}

function deepMergeConfig(base: PingpongConfig, partial: Record<string, unknown>): PingpongConfig {
  const result: PingpongConfig = { ...base };

  if (partial.llm) {
    result.llm = { ...base.llm, ...partial.llm };
  }

  if (partial.prd) {
    result.prd = { ...base.prd, ...partial.prd };
  }

  if (partial.review) {
    result.review = { ...base.review, ...partial.review };
  }

  if (partial.escalation) {
    result.escalation = { ...base.escalation, ...partial.escalation };
  }

  if (partial.gitDiff) {
    result.gitDiff = { ...base.gitDiff, ...partial.gitDiff };
  }

  return result;
}

function applyEnvOverrides(config: PingpongConfig): PingpongConfig {
  const result: PingpongConfig = { ...config };

  if (process.env.PINGPONG_LLM_ENDPOINT) {
    try {
      new URL(process.env.PINGPONG_LLM_ENDPOINT);
      result.llm.endpoint = process.env.PINGPONG_LLM_ENDPOINT;
    } catch {
      console.warn(`[WARN] Invalid PINGPONG_LLM_ENDPOINT: ${process.env.PINGPONG_LLM_ENDPOINT}, using default`);
    }
  }

  if (process.env.PINGPONG_LLM_MODEL) {
    result.llm.model = process.env.PINGPONG_LLM_MODEL;
  }

  if (process.env.PINGPONG_LLM_TIMEOUT) {
    const timeout = parseInt(process.env.PINGPONG_LLM_TIMEOUT, 10);
    if (!isNaN(timeout) && timeout > 0) {
      result.llm.timeout = timeout;
    } else {
      console.warn(`[WARN] Invalid PINGPONG_LLM_TIMEOUT: ${process.env.PINGPONG_LLM_TIMEOUT}, using default`);
    }
  }

  if (process.env.PINGPONG_PRD_PATH) {
    result.prd.fallbackPath = process.env.PINGPONG_PRD_PATH;
  }

  if (process.env.PINGPONG_ESCALATION_PORT) {
    const port = parseInt(process.env.PINGPONG_ESCALATION_PORT, 10);
    if (!isNaN(port) && port >= 1024 && port <= 65535) {
      result.escalation.port = port;
    } else {
      console.warn(`[WARN] Invalid PINGPONG_ESCALATION_PORT: ${process.env.PINGPONG_ESCALATION_PORT}, using default`);
    }
  }

  return result;
}
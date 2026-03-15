# Pingpong Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Pingpong, an MCP server that provides automated code review using a local LLM (llama.cpp) instead of human review, with escalation to human web UI after 5 iterations or on errors.

**Architecture:** Node.js/TypeScript MCP server using @modelcontextprotocol/sdk. Components: MCP server (request_review tool), LLM client (llama.cpp communication), context gatherers (PRD locator, git diff reader), session manager (/tmp/pingpong-sessions/), review loop controller (iterations, error handling), escalation server (Express web UI), HTTP API (monitoring).

**Tech Stack:** TypeScript, Node.js, @modelcontextprotocol/sdk, Express, Axios, Vitest

---

## File Structure

```
pingpong/
├── src/
│   ├── index.ts                 # MCP server entry point
│   ├── config.ts                # Config loader with defaults
│   ├── llm-client.ts            # llama.cpp communication
│   ├── git-diff.ts              # Git diff reader
│   ├── prd-locator.ts           # PRD auto-detection
│   ├── session-manager.ts       # Session persistence (/tmp/)
│   ├── escalation-server.ts     # Express web UI (conditional)
│   ├── review-prompt.ts         # Built-in review criteria builder
│   └── types.ts                 # TypeScript definitions
├── templates/
│   ├── APPEND_SYSTEM.md         # Agent contract template
│   └── AGENTS.md                # Local LLM prompt template
├── tests/
│   ├── unit/
│   │   ├── config.test.ts
│   │   ├── prd-locator.test.ts
│   │   ├── git-diff.test.ts
│   │   ├── llm-client.test.ts
│   │   └── session-manager.test.ts
│   └── integration/
│       ├── review-flow.test.ts
│       └── escalation-flow.test.ts
├── package.json
├── tsconfig.json
├── README.md
└── pingpong.config.example.json
```

---

## Chunk 1: Project Setup & Core Infrastructure

### Task 1: Initialize Project Structure

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `pingpong.config.example.json`

- [ ] **Step 1: Initialize package.json**

```bash
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install @modelcontextprotocol/sdk express axios nanoid
npm install -D typescript @types/node @types/express vitest @types/vitest
```

- [ ] **Step 3: Create package.json with proper config**

```json
{
  "name": "pingpong",
  "version": "1.0.0",
  "description": "Automated code review MCP using local LLM",
  "main": "dist/index.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsc && node dist/index.js",
    "test": "vitest",
    "test:unit": "vitest tests/unit",
    "test:integration": "vitest tests/integration",
    "watch": "tsc --watch"
  },
  "bin": {
    "pingpong": "./dist/index.js"
  },
  "keywords": ["mcp", "llm", "code-review", "copilot"],
  "license": "MIT",
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.4",
    "axios": "^1.6.0",
    "express": "^4.18.0",
    "nanoid": "^5.0.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.0",
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
*.log
.DS_Store
pingpong.config.json
/tmp/pingpong-sessions/
```

- [ ] **Step 6: Create example config**

```json
{
  "llm": {
    "endpoint": "http://127.0.0.1:8080/v1/chat/completions",
    "model": "default",
    "timeout": 1800
  },
  "prd": {
    "autoDetect": true,
    "paths": ["./docs/PRD.md", "./PRD.md", "./README.md"],
    "fallbackPath": null
  },
  "review": {
    "maxIterations": 5,
    "retryOnLlmError": true
  },
  "escalation": {
    "port": 3456,
    "autoOpenBrowser": true
  }
}
```

- [ ] **Step 7: Commit setup**

```bash
git add .
git commit -m "chore: initialize project with dependencies and config"
```

---

### Task 2: Define TypeScript Types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write the type definitions**

```typescript
/**
 * Review session status
 */
export type ReviewStatus = 'pending' | 'approved' | 'needs_revision' | 'escalated';

/**
 * Reviewer type (LLM or human)
 */
export type ReviewerType = 'llm' | 'human';

/**
 * MCP tool input for request_review
 */
export interface RequestReviewInput {
  taskId: string;
  summary: string;
  details?: string;
  conversationHistory?: string;
}

/**
 * MCP tool output from request_review
 */
export interface RequestReviewResult {
  status: ReviewStatus;
  feedback: string;
  sessionId: string;
  iterationCount: number;
  reviewerType: ReviewerType;
}

/**
 * Review session stored in /tmp/pingpong-sessions/
 */
export interface ReviewSession {
  sessionId: string;
  taskId: string;
  summary: string;
  details?: string;
  conversationHistory?: string;
  status: ReviewStatus;
  feedback?: string;
  iterationCount: number;
  reviewerType: ReviewerType;
  prdPath?: string;
  gitDiff?: string;
  createdAt: number;
  updatedAt: number;
  agentResolve?: (feedback: string) => void;
}

/**
 * Pingpong configuration from pingpong.config.json
 */
export interface PingpongConfig {
  llm: {
    endpoint: string;
    model: string;
    timeout: number;
  };
  prd: {
    autoDetect: boolean;
    paths: string[];
    fallbackPath: string | null;
  };
  review: {
    maxIterations: number;
    retryOnLlmError: boolean;
  };
  escalation: {
    port: number;
    autoOpenBrowser: boolean;
  };
  gitDiff?: {
    maxSizeBytes?: number;
  };
}

/**
 * LLM request to llama.cpp
 */
export interface LLMRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature: number;
  max_tokens: number;
}

/**
 * LLM response from llama.cpp
 */
export interface LLMResponse {
  choices: Array<{
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
}

/**
 * HTTP API session response
 */
export interface APISession {
  sessionId: string;
  taskId: string;
  summary: string;
  status: ReviewStatus;
  iterationCount: number;
  reviewerType: ReviewerType;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit types**

```bash
git add src/types.ts
git commit -m "feat: define TypeScript types for MCP, config, sessions, and LLM"
```

---

## Chunk 2: Configuration & Context Gathering

### Task 3: Implement Config Loader

**Files:**
- Create: `src/config.ts`
- Test: `tests/unit/config.test.ts`

- [ ] **Step 1: Write failing test for config loading**

```typescript
// tests/unit/config.test.ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';
import fs from 'fs/promises';

describe('config', () => {
  it('should load default config when no config file exists', async () => {
    const config = await loadConfig('/tmp/nonexistent');
    expect(config.llm.endpoint).toBe('http://127.0.0.1:8080/v1/chat/completions');
    expect(config.llm.model).toBe('default');
    expect(config.llm.timeout).toBe(1800);
    expect(config.review.maxIterations).toBe(5);
  });

  it('should load config from pingpong.config.json', async () => {
    const testDir = '/tmp/test-config';
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(
      `${testDir}/pingpong.config.json`,
      JSON.stringify({
        llm: { endpoint: 'http://localhost:9999', model: 'custom', timeout: 100 },
        prd: { autoDetect: false, paths: ['./custom.md'], fallbackPath: null },
        review: { maxIterations: 3, retryOnLlmError: false },
        escalation: { port: 4000, autoOpenBrowser: false }
      })
    );

    const config = await loadConfig(testDir);
    expect(config.llm.endpoint).toBe('http://localhost:9999');
    expect(config.llm.model).toBe('custom');
    expect(config.llm.timeout).toBe(100);
    expect(config.review.maxIterations).toBe(3);

    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should override config with environment variables', async () => {
    process.env.PINGPONG_LLM_ENDPOINT = 'http://env-override:8080';
    process.env.PINGPONG_LLM_MODEL = 'env-model';
    process.env.PINGPONG_LLM_TIMEOUT = '500';
    process.env.PINGPONG_PRD_PATH = '/env/prd.md';

    const config = await loadConfig('/tmp');
    expect(config.llm.endpoint).toBe('http://env-override:8080');
    expect(config.llm.model).toBe('env-model');
    expect(config.llm.timeout).toBe(500);
    expect(config.prd.fallbackPath).toBe('/env/prd.md');

    delete process.env.PINGPONG_LLM_ENDPOINT;
    delete process.env.PINGPONG_LLM_MODEL;
    delete process.env.PINGPONG_LLM_TIMEOUT;
    delete process.env.PINGPONG_PRD_PATH;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/config.test.ts
```

Expected: FAIL with "Cannot find module '../../src/config'"

- [ ] **Step 3: Implement config loader**

```typescript
// src/config.ts
import fs from 'fs/promises';
import path from 'path';
import type { PingpongConfig } from './types.js';

const DEFAULT_CONFIG: PingpongConfig = {
  llm: {
    endpoint: 'http://127.0.0.1:8080/v1/chat/completions',
    model: 'default',
    timeout: 1800
  },
  prd: {
    autoDetect: true,
    paths: ['./docs/PRD.md', './PRD.md', './README.md'],
    fallbackPath: null
  },
  review: {
    maxIterations: 5,
    retryOnLlmError: true
  },
  escalation: {
    port: 3456,
    autoOpenBrowser: true
  },
  gitDiff: {
    maxSizeBytes: 100 * 1024 // 100KB
  }
};

export async function loadConfig(projectRoot: string): Promise<PingpongConfig> {
  const configPath = path.join(projectRoot, 'pingpong.config.json');

  let config = { ...DEFAULT_CONFIG };

  try {
    const fileContent = await fs.readFile(configPath, 'utf-8');
    const userConfig = JSON.parse(fileContent);
    config = { ...config, ...userConfig };
  } catch (error) {
    // Config file doesn't exist or is invalid, use defaults
  }

  // Environment variable overrides
  if (process.env.PINGPONG_LLM_ENDPOINT) {
    config.llm.endpoint = process.env.PINGPONG_LLM_ENDPOINT;
  }
  if (process.env.PINGPONG_LLM_MODEL) {
    config.llm.model = process.env.PINGPONG_LLM_MODEL;
  }
  if (process.env.PINGPONG_LLM_TIMEOUT) {
    config.llm.timeout = parseInt(process.env.PINGPONG_LLM_TIMEOUT, 10);
  }
  if (process.env.PINGPONG_PRD_PATH) {
    config.prd.fallbackPath = process.env.PINGPONG_PRD_PATH;
  }

  return validateConfig(config);
}

function validateConfig(config: PingpongConfig): PingpongConfig {
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/config.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit config loader**

```bash
git add src/config.ts tests/unit/config.test.ts
git commit -m "feat: implement config loader with defaults and env overrides"
```

---

### Task 4: Implement PRD Locator

**Files:**
- Create: `src/prd-locator.ts`
- Test: `tests/unit/prd-locator.test.ts`

- [ ] **Step 1: Write failing test for PRD detection**

```typescript
// tests/unit/prd-locator.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findPRD } from '../../src/prd-locator.js';
import fs from 'fs/promises';

describe('prd-locator', () => {
  const testDir = '/tmp/test-prd-locator';

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should find PRD in ./docs/PRD.md', async () => {
    await fs.mkdir(`${testDir}/docs`, { recursive: true });
    await fs.writeFile(`${testDir}/docs/PRD.md`, '# Test PRD');

    const result = await findPRD(testDir, ['./docs/PRD.md', './PRD.md', './README.md']);
    expect(result).toBe(`${testDir}/docs/PRD.md`);
  });

  it('should find PRD in ./PRD.md', async () => {
    await fs.writeFile(`${testDir}/PRD.md`, '# Test PRD');

    const result = await findPRD(testDir, ['./docs/PRD.md', './PRD.md', './README.md']);
    expect(result).toBe(`${testDir}/PRD.md`);
  });

  it('should find PRD in ./README.md as fallback', async () => {
    await fs.writeFile(`${testDir}/README.md`, '# Test README');

    const result = await findPRD(testDir, ['./docs/PRD.md', './PRD.md', './README.md']);
    expect(result).toBe(`${testDir}/README.md`);
  });

  it('should return null if no PRD found', async () => {
    const result = await findPRD(testDir, ['./docs/PRD.md', './PRD.md', './README.md']);
    expect(result).toBeNull();
  });

  it('should use fallbackPath if provided', async () => {
    await fs.writeFile('/tmp/fallback-prd.md', '# Fallback PRD');

    const result = await findPRD(testDir, ['./docs/PRD.md'], '/tmp/fallback-prd.md');
    expect(result).toBe('/tmp/fallback-prd.md');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/prd-locator.test.ts
```

Expected: FAIL with "Cannot find module '../../src/prd-locator'"

- [ ] **Step 3: Implement PRD locator**

```typescript
// src/prd-locator.ts
import fs from 'fs/promises';
import path from 'path';

export async function findPRD(
  projectRoot: string,
  searchPaths: string[],
  fallbackPath: string | null
): Promise<string | null> {
  // Try each search path
  for (const searchPath of searchPaths) {
    const fullPath = path.join(projectRoot, searchPath);
    try {
      await fs.access(fullPath);
      return fullPath;
    } catch {
      // File doesn't exist, try next
    }
  }

  // Try fallback path if provided
  if (fallbackPath) {
    try {
      await fs.access(fallbackPath);
      return fallbackPath;
    } catch {
      // Fallback doesn't exist
    }
  }

  return null;
}

export async function readPRD(prdPath: string): Promise<string> {
  return await fs.readFile(prdPath, 'utf-8');
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/prd-locator.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit PRD locator**

```bash
git add src/prd-locator.ts tests/unit/prd-locator.test.ts
git commit -m "feat: implement PRD auto-detection with fallback paths"
```

---

### Task 5: Implement Git Diff Reader

**Files:**
- Create: `src/git-diff.ts`
- Test: `tests/unit/git-diff.test.ts'

- [ ] **Step 1: Write failing test for git diff reading**

```typescript
// tests/unit/git-diff.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readGitDiff } from '../../src/git-diff.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

describe('git-diff', () => {
  const testRepo = '/tmp/test-git-diff';

  beforeEach(async () => {
    await execAsync(`rm -rf ${testRepo}`);
    await execAsync(`mkdir -p ${testRepo}`);
    await execAsync(`cd ${testRepo} && git init`);
    await execAsync(`cd ${testRepo} && git config user.email "test@test.com"`);
    await execAsync(`cd ${testRepo} && git config user.name "Test"`);
  });

  afterEach(async () => {
    await execAsync(`rm -rf ${testRepo}`);
  });

  it('should read unstaged changes', async () => {
    await execAsync(`echo "initial" > ${testRepo}/test.txt`);
    await execAsync(`cd ${testRepo} && git add test.txt && git commit -m "initial"`);
    await execAsync(`echo "modified" > ${testRepo}/test.txt`);

    const diff = await readGitDiff(testRepo);
    expect(diff).toContain('modified');
  });

  it('should read staged changes', async () => {
    await execAsync(`echo "initial" > ${testRepo}/test.txt`);
    await execAsync(`cd ${testRepo} && git add test.txt && git commit -m "initial"`);
    await execAsync(`echo "staged" > ${testRepo}/test.txt`);
    await execAsync(`cd ${testRepo} && git add test.txt`);

    const diff = await readGitDiff(testRepo);
    expect(diff).toContain('staged');
  });

  it('should return empty string when no changes', async () => {
    const diff = await readGitDiff(testRepo);
    expect(diff).toBe('');
  });

  it('should return empty string when not a git repo', async () => {
    const diff = await readGitDiff('/tmp/nonexistent-repo');
    expect(diff).toBe('');
  });

  it('should truncate large diffs', async () => {
    // Create a large file
    const largeContent = 'x'.repeat(200 * 1024); // 200KB
    await execAsync(`echo "${largeContent}" > ${testRepo}/large.txt`);
    await execAsync(`cd ${testRepo} && git add large.txt && git commit -m "initial"`);
    await execAsync(`echo "modified" > ${testRepo}/large.txt`);

    const diff = await readGitDiff(testRepo, 100 * 1024); // 100KB limit
    expect(diff.length).toBeLessThanOrEqual(100 * 1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/git-diff.test.ts
```

Expected: FAIL with "Cannot find module '../../src/git-diff'"

- [ ] **Step 3: Implement git diff reader**

```typescript
// src/git-diff.ts
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function readGitDiff(
  projectRoot: string,
  maxSizeBytes: number = 100 * 1024 // Default 100KB
): Promise<string> {
  try {
    const { stdout } = await execAsync('git diff HEAD', {
      cwd: projectRoot,
      maxBuffer: 1024 * 1024 * 10 // 10MB buffer
    });

    // Truncate if exceeds max size
    if (stdout.length > maxSizeBytes) {
      const truncated = stdout.substring(0, maxSizeBytes);
      console.warn(
        `[WARN] Git diff truncated from ${stdout.length} bytes to ${maxSizeBytes} bytes`
      );
      return truncated;
    }

    return stdout;
  } catch (error: any) {
    // Not a git repository or git command failed
    if (error.killed || error.signal || error.code) {
      console.error('[ERROR] Git diff failed:', error.message);
      return '';
    }
    return '';
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/git-diff.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit git diff reader**

```bash
git add src/git-diff.ts tests/unit/git-diff.test.ts
git commit -m "feat: implement git diff reader with truncation for large diffs"
```

---

## Chunk 3: Session Management

### Task 6: Implement Session Manager

**Files:**
- Create: `src/session-manager.ts`
- Test: `tests/unit/session-manager.test.ts`

- [ ] **Step 1: Write failing test for session CRUD**

```typescript
// tests/unit/session-manager.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/session-manager.js';
import type { ReviewSession } from '../../src/types.js';
import fs from 'fs/promises';

describe('session-manager', () => {
  const sessionDir = '/tmp/test-sessions';
  let manager: SessionManager;

  beforeEach(async () => {
    await fs.mkdir(sessionDir, { recursive: true });
    manager = new SessionManager(sessionDir);
  });

  afterEach(async () => {
    await fs.rm(sessionDir, { recursive: true, force: true });
  });

  it('should create a new session', () => {
    const session = manager.createSession({
      taskId: 'task-001',
      summary: 'Test summary'
    });

    expect(session.sessionId).toBeDefined();
    expect(session.taskId).toBe('task-001');
    expect(session.status).toBe('pending');
    expect(session.iterationCount).toBe(0);
    expect(session.createdAt).toBeDefined();
  });

  it('should get an existing session', () => {
    const created = manager.createSession({
      taskId: 'task-001',
      summary: 'Test summary'
    });

    const retrieved = manager.getSession(created.sessionId);
    expect(retrieved).toBeDefined();
    expect(retrieved?.taskId).toBe('task-001');
  });

  it('should return null for non-existent session', () => {
    const session = manager.getSession('nonexistent');
    expect(session).toBeNull();
  });

  it('should update session status and feedback', () => {
    const session = manager.createSession({
      taskId: 'task-001',
      summary: 'Test summary'
    });

    manager.updateSession(session.sessionId, {
      status: 'needs_revision',
      feedback: 'Fix these issues',
      reviewerType: 'llm'
    });

    const updated = manager.getSession(session.sessionId);
    expect(updated?.status).toBe('needs_revision');
    expect(updated?.feedback).toBe('Fix these issues');
    expect(updated?.reviewerType).toBe('llm');
  });

  it('should increment iteration count', () => {
    const session = manager.createSession({
      taskId: 'task-001',
      summary: 'Test summary'
    });

    manager.incrementIteration(session.sessionId);

    const updated = manager.getSession(session.sessionId);
    expect(updated?.iterationCount).toBe(1);
  });

  it('should list all sessions', () => {
    const s1 = manager.createSession({ taskId: 'task-001', summary: 'Summary 1' });
    const s2 = manager.createSession({ taskId: 'task-002', summary: 'Summary 2' });

    const sessions = manager.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.sessionId === s1.sessionId)).toBeDefined();
    expect(sessions.find((s) => s.sessionId === s2.sessionId)).toBeDefined();
  });

  it('should delete old sessions (cleanup)', () => {
    const oldSession = manager.createSession({
      taskId: 'old-task',
      summary: 'Old summary'
    });

    // Manually set createdAt to 25 hours ago
    const sessions = manager.listSessions();
    const session = sessions.find((s) => s.sessionId === oldSession.sessionId);
    if (session) {
      (session as any).createdAt = Date.now() - 25 * 60 * 60 * 1000;
    }

    const newSession = manager.createSession({
      taskId: 'new-task',
      summary: 'New summary'
    });

    manager.cleanup(24 * 60 * 60 * 1000); // 24 hours

    const remaining = manager.listSessions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sessionId).toBe(newSession.sessionId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/session-manager.test.ts
```

Expected: FAIL with "Cannot find module '../../src/session-manager'"

- [ ] **Step 3: Implement session manager**

```typescript
// src/session-manager.ts
import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';
import type { ReviewSession } from './types.js';

export class SessionManager {
  private sessions: Map<string, ReviewSession> = new Map();
  private sessionDir: string;

  constructor(sessionDir: string) {
    this.sessionDir = sessionDir;
    this.loadSessions();
  }

  private async loadSessions(): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      const files = await fs.readdir(this.sessionDir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.sessionDir, file), 'utf-8');
          const session = JSON.parse(content) as ReviewSession;
          this.sessions.set(session.sessionId, session);
        }
      }
    } catch {
      // Session dir doesn't exist or is empty, start fresh
    }
  }

  private async saveSession(session: ReviewSession): Promise<void> {
    try {
      await fs.mkdir(this.sessionDir, { recursive: true });
      await fs.writeFile(
        path.join(this.sessionDir, `${session.sessionId}.json`),
        JSON.stringify(session, null, 2)
      );
    } catch (error) {
      console.error('[ERROR] Failed to save session:', error);
    }
  }

  private async deleteSessionFile(sessionId: string): Promise<void> {
    try {
      await fs.unlink(path.join(this.sessionDir, `${sessionId}.json`));
    } catch {
      // File doesn't exist
    }
  }
    this.sessionDir = sessionDir;
  }

  createSession(input: {
    taskId: string;
    summary: string;
    details?: string;
    conversationHistory?: string;
    prdPath?: string;
    gitDiff?: string;
  }): ReviewSession {
    const session: ReviewSession = {
      sessionId: nanoid(10),
      taskId: input.taskId,
      summary: input.summary,
      details: input.details,
      conversationHistory: input.conversationHistory,
      prdPath: input.prdPath,
      gitDiff: input.gitDiff,
      status: 'pending',
      iterationCount: 0,
      reviewerType: 'llm',
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.sessions.set(session.sessionId, session);
    this.saveSession(session);
    return session;
  }

  getSession(sessionId: string): ReviewSession | null {
    return this.sessions.get(sessionId) || null;
  }

  updateSession(
    sessionId: string,
    updates: Partial<Pick<ReviewSession, 'status' | 'feedback' | 'reviewerType'>>
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    Object.assign(session, updates, { updatedAt: Date.now() });
    this.saveSession(session);
  }
  incrementIteration(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.iterationCount++;
    session.updatedAt = Date.now();
    this.saveSession(session);
  }
  listSessions(): ReviewSession[] {
    return Array.from(this.sessions.values());
  }

  cleanup(maxAgeMs: number): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.createdAt > maxAgeMs) {
        this.sessions.delete(sessionId);
        this.deleteSessionFile(sessionId);
      }
    }
  }

  setResolveCallback(sessionId: string, callback: (feedback: string) => void): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.agentResolve = callback;
    }
  }

  resolveSession(sessionId: string, feedback: string): void {
    const session = this.sessions.get(sessionId);
    if (session?.agentResolve) {
      session.agentResolve(feedback);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/session-manager.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit session manager**

```bash
git add src/session-manager.ts tests/unit/session-manager.test.ts
git commit -m "feat: implement session manager with CRUD and cleanup"
```

---

## Chunk 4: LLM Integration

### Task 7: Implement LLM Client

**Files:**
- Create: `src/llm-client.ts`
- Test: `tests/unit/llm-client.test.ts`

- [ ] **Step 1: Write failing test for LLM communication**

```typescript
// tests/unit/llm-client.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { LLMClient } from '../../src/llm-client.js';
import axios from 'axios';

vi.mock('axios');

describe('llm-client', () => {
  let client: LLMClient;

  beforeEach(() => {
    client = new LLMClient('http://127.0.0.1:8080/v1/chat/completions', 'default', 30);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should send review request to LLM', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'STATUS: approved\n\nLooks good!'
            },
            finish_reason: 'stop'
          }
        ]
      }
    });

    const result = await client.sendReview(
      'Task summary',
      'PRD content',
      'Git diff',
      'Conversation history',
      'Review criteria'
    );

    expect(result.status).toBe('approved');
    expect(result.feedback).toContain('Looks good!');
    expect(axios.post).toHaveBeenCalledWith(
      'http://127.0.0.1:8080/v1/chat/completions',
      expect.objectContaining({
        model: 'default',
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'system' }),
          expect.objectContaining({ role: 'user' })
        ])
      })
    );
  });

  it('should parse STATUS: needs_revision', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'STATUS: needs_revision\n\nFix the security issue.'
            },
            finish_reason: 'stop'
          }
        ]
      }
    });

    const result = await client.sendReview(
      'Task summary',
      'PRD content',
      'Git diff',
      '',
      'Review criteria'
    );

    expect(result.status).toBe('needs_revision');
    expect(result.feedback).toContain('Fix the security issue.');
  });

  it('should handle timeout', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error('timeout of 30000ms exceeded'));

    await expect(
      client.sendReview('Task summary', 'PRD content', 'Git diff', '', 'Review criteria')
    ).rejects.toThrow('timeout');
  });

  it('should handle connection refused', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(
      client.sendReview('Task summary', 'PRD content', 'Git diff', '', 'Review criteria')
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('should throw on invalid response (no STATUS:)', async () => {
    vi.mocked(axios.post).mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'This looks good but no STATUS prefix'
            },
            finish_reason: 'stop'
          }
        ]
      }
    });

    await expect(
      client.sendReview('Task summary', 'PRD content', 'Git diff', '', 'Review criteria')
    ).rejects.toThrow('Invalid LLM response');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- tests/unit/llm-client.test.ts
```

Expected: FAIL with "Cannot find module '../../src/llm-client'"

- [ ] **Step 3: Implement LLM client**

```typescript
// src/llm-client.ts
import axios, { AxiosError } from 'axios';

export interface LLMReviewResult {
  status: 'approved' | 'needs_revision';
  feedback: string;
}

export class LLMClient {
  private endpoint: string;
  private model: string;
  private timeout: number;

  constructor(endpoint: string, model: string, timeout: number) {
    this.endpoint = endpoint;
    this.model = model;
    this.timeout = timeout * 1000; // Convert to milliseconds
  }

  async sendReview(
    summary: string,
    prd: string,
    gitDiff: string,
    conversationHistory: string,
    reviewCriteria: string
  ): Promise<LLMReviewResult> {
    const userPrompt = this.buildUserPrompt(summary, prd, gitDiff, conversationHistory);

    try {
      const response = await axios.post(
        this.endpoint,
        {
          model: this.model,
          messages: [
            {
              role: 'system',
              content: reviewCriteria
            },
            {
              role: 'user',
              content: userPrompt
            }
          ],
          temperature: 0.3,
          max_tokens: 2000
        },
        {
          timeout: this.timeout
        }
      );

      const content = response.data.choices[0]?.message?.content || '';
      return this.parseResponse(content);
    } catch (error: any) {
      if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
        throw new Error(`LLM timeout after ${this.timeout / 1000} seconds`);
      }
      if (error.code === 'ECONNREFUSED') {
        throw new Error('LLM connection refused');
      }
      throw error;
    }
  }

  private buildUserPrompt(
    summary: string,
    prd: string,
    gitDiff: string,
    conversationHistory: string
  ): string {
    let prompt = `TASK SUMMARY:\n${summary}\n\n`;

    if (prd) {
      prompt += `PRD:\n${prd}\n\n`;
    }

    if (gitDiff) {
      const note = gitDiff.length >= 100 * 1024
        ? '\n<note>Git diff was truncated due to size. Showing first 100KB.</note>'
        : '';
      prompt += `GIT DIFF:${note}\n${gitDiff}\n\n`;
    }

    if (conversationHistory) {
      prompt += `CONVERSATION HISTORY:\n${conversationHistory}\n\n`;
    }

    return prompt;
  }

  private parseResponse(content: string): LLMReviewResult {
    const trimmed = content.trim();

    if (trimmed.startsWith('STATUS: approved')) {
      const feedback = trimmed.replace('STATUS: approved', '').trim();
      return { status: 'approved', feedback: feedback || 'Approved' };
    }

    if (trimmed.startsWith('STATUS: needs_revision')) {
      const feedback = trimmed.replace('STATUS: needs_revision', '').trim();
      return { status: 'needs_revision', feedback };
    }

    throw new Error('Invalid LLM response: Missing STATUS: prefix');
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- tests/unit/llm-client.test.ts
```

Expected: PASS

- [ ] **Step 5: Commit LLM client**

```bash
git add src/llm-client.ts tests/unit/llm-client.test.ts
git commit -m "feat: implement LLM client with request/response parsing"
```

---

### Task 8: Implement Review Prompt Builder

**Files:**
- Create: `src/review-prompt.ts`

- [ ] **Step 1: Write review prompt builder**

```typescript
// src/review-prompt.ts
import fs from 'fs/promises';

const BUILT_IN_REVIEW_CRITERIA = `# Pingpong Local LLM Review Instructions

You are an expert code reviewer. Your task is to evaluate the agent's work against the project PRD and comprehensive review criteria.

## Review Process

1. **Read the provided context:**
   - Task summary: what the agent did
   - Project PRD: requirements and specifications
   - Git diff: actual code changes
   - Conversation history: context and decisions
   - Built-in review criteria: your evaluation framework

2. **Evaluate systematically:**
   - Correctness: Does it work? Edge cases handled?
   - Code Quality: Idiomatic, clear, maintainable?
   - Security: No vulnerabilities, proper validation?
   - Performance: Efficient, no obvious anti-patterns?
   - Maintainability: Single responsibility, DRY, clear abstractions?
   - Documentation: Docstrings, comments for non-obvious logic?

3. **Check PRD alignment:**
   - Does the implementation match requirements?
   - Are all acceptance criteria met?
   - Any missing features or behaviors?

4. **Provide feedback:**
   - If approved: Output exactly \`STATUS: approved\` followed by optional praise
   - If needs revision: Output exactly \`STATUS: needs_revision\` followed by specific, actionable feedback
   - Be specific: what to fix, why it matters, how to fix it
   - Prioritize: critical issues first, minor improvements last

## Response Format

You MUST start your response with either:
\`\`\`
STATUS: approved
<optional feedback>
\`\`\`
OR
\`\`\`
STATUS: needs_revision
<specific feedback on what to fix>
\`\`\`

## Review Standards

- Be thorough but fair
- Explain why something is wrong, not just that it's wrong
- Suggest concrete improvements
- Recognize good work when you see it
- Consider the agent's constraints (single request, iteration limits)
`;

export async function loadAgentPrompt(templatePath: string): Promise<string> {
  try {
    return await fs.readFile(templatePath, 'utf-8');
  } catch {
    return BUILT_IN_REVIEW_CRITERIA;
  }
}

export function getBuiltInCriteria(): string {
  return BUILT_IN_REVIEW_CRITERIA;
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit review prompt builder**

```bash
git add src/review-prompt.ts
git commit -m "feat: implement review prompt builder with built-in criteria"
```

---

## Chunk 5: MCP Server & Review Loop

### Task 9: Implement MCP Server

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Write MCP server**

```typescript
// src/index.ts
#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { SessionManager } from './session-manager.js';
import { loadConfig } from './config.js';
import { findPRD, readPRD } from './prd-locator.js';
import { readGitDiff } from './git-diff.js';
import { LLMClient } from './llm-client.js';
import { getBuiltInCriteria, loadAgentPrompt } from './review-prompt.js';
import { startEscalationServer } from './escalation-server.js';
import type { RequestReviewInput, ReviewSession } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PingpongMCPServer {
  private server: Server;
  private sessionManager: SessionManager;
  private config: any;
  private llmClient: LLMClient;
  private escalationPort: number;

  constructor() {
    this.server = new Server(
      {
        name: 'pingpong',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    );

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private async initialize() {
    const projectRoot = process.cwd();
    this.config = await loadConfig(projectRoot);

    this.sessionManager = new SessionManager('/tmp/pingpong-sessions/');
    this.llmClient = new LLMClient(
      this.config.llm.endpoint,
      this.config.llm.model,
      this.config.llm.timeout
    );
    this.escalationPort = this.config.escalation.port;

    // Start cleanup interval (hourly)
    setInterval(() => {
      this.sessionManager.cleanup(24 * 60 * 60 * 1000); // 24 hours
    }, 60 * 60 * 1000);

    console.error('Pingpong MCP Server initialized');
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'request_review',
          description:
            'Request automated code review from local LLM. After completing work, call this tool with taskId and summary. The LLM will review against the PRD and comprehensive criteria. If approved, task complete. If needs_revision, improve and call again. Escalates to human after 5 iterations or on LLM errors.',
          inputSchema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'Unique task identifier (e.g., feature-20260314-001)'
              },
              summary: {
                type: 'string',
                description: '2-3 sentence summary of work completed'
              },
              details: {
                type: 'string',
                description: 'Optional additional context'
              },
              conversationHistory: {
                type: 'string',
                description: 'Optional full conversation for context'
              }
            },
            required: ['taskId', 'summary']
          }
        }
      ]
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      if (request.params.name !== 'request_review') {
        throw new Error(`Unknown tool: ${request.params.name}`);
      }

      const input = request.params.arguments as RequestReviewInput;

      if (!input.taskId || !input.summary) {
        throw new Error('taskId and summary are required');
      }

      return await this.handleReview(input);
    });
  }

  private async handleReview(input: RequestReviewInput) {
    const projectRoot = process.cwd();

    // Check for existing session (iteration)
    const existingSessions = this.sessionManager.listSessions();
    const existingSession = existingSessions.find((s) => s.taskId === input.taskId);

    let session: ReviewSession;
    let iterationCount = 0;

    if (existingSession) {
      session = existingSession;
      iterationCount = session.iterationCount;
      this.sessionManager.incrementIteration(session.sessionId);
      iterationCount++;
    } else {
      // New session - gather context
      const prdPath = await findPRD(
        projectRoot,
        this.config.prd.paths,
        this.config.prd.fallbackPath
      );
      const prd = prdPath ? await readPRD(prdPath) : '';
      const gitDiff = await readGitDiff(projectRoot, this.config.gitDiff?.maxSizeBytes);

      session = this.sessionManager.createSession({
        taskId: input.taskId,
        summary: input.summary,
        details: input.details,
        conversationHistory: input.conversationHistory,
        prdPath: prdPath || undefined,
        gitDiff: gitDiff || undefined
      });

      if (!prd) {
        console.warn(`[WARN] PRD not found, checked: ${this.config.prd.paths.join(', ')}`);
      }
      if (!gitDiff) {
        console.info('[INFO] No git changes detected');
      }
    }

    // Check iteration limit
    if (iterationCount > this.config.review.maxIterations) {
      return await this.escalateToHuman(session);
    }

    // LLM Review
    try {
      const reviewCriteria = getBuiltInCriteria();
      const result = await this.llmClient.sendReview(
        input.summary,
        session.prdPath ? await readPRD(session.prdPath) : '',
        session.gitDiff || '',
        input.conversationHistory || '',
        reviewCriteria
      );

      this.sessionManager.updateSession(session.sessionId, {
        status: result.status,
        feedback: result.feedback,
        reviewerType: 'llm'
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                status: result.status,
                feedback: result.feedback,
                sessionId: session.sessionId,
                iterationCount,
                reviewerType: 'llm',
                message:
                  result.status === 'approved'
                    ? '✅ Review approved! Task complete.'
                    : `⚠️ Needs revision (iteration ${iterationCount}/${this.config.review.maxIterations}): ${result.feedback}\n\nImprove based on feedback and call request_review again.`
              },
              null,
              2
            )
          }
        ]
      };
    } catch (error: any) {
      console.error(`[ERROR] LLM review failed: ${error.message}`);

      if (this.config.review.retryOnLlmError) {
        console.error('[INFO] Retrying LLM call once...');
        try {
          const reviewCriteria = getBuiltInCriteria();
          const result = await this.llmClient.sendReview(
            input.summary,
            session.prdPath ? await readPRD(session.prdPath) : '',
            session.gitDiff || '',
            input.conversationHistory || '',
            reviewCriteria
          );

          this.sessionManager.updateSession(session.sessionId, {
            status: result.status,
            feedback: result.feedback,
            reviewerType: 'llm'
          });

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    status: result.status,
                    feedback: result.feedback,
                    sessionId: session.sessionId,
                    iterationCount,
                    reviewerType: 'llm',
                    message: `✅ Review successful on retry: ${result.status}`
                  },
                  null,
                  2
                )
              }
            ]
          };
        } catch (retryError: any) {
          console.error(`[ERROR] LLM retry failed: ${retryError.message}`);
          return await this.escalateToHuman(session);
        }
      }

      return await this.escalateToHuman(session);
    }
  }

  private async escalateToHuman(session: ReviewSession) {
    console.error('[INFO] Escalating to human review...');

    this.sessionManager.updateSession(session.sessionId, {
      status: 'escalated',
      feedback: 'Escalated to human review',
      reviewerType: 'human'
    });

    // Start escalation server
    const escalationServer = await startEscalationServer(
      this.escalationPort,
      this.sessionManager,
      this.config.escalation.autoOpenBrowser
    );

    // Wait for human feedback
    const feedback = await new Promise<string>((resolve) => {
      this.sessionManager.setResolveCallback(session.sessionId, resolve);
    });

    this.sessionManager.updateSession(session.sessionId, {
      status: feedback.toLowerCase().match(/^(ok|approved|lgtm)$/) ? 'approved' : 'needs_revision',
      feedback: feedback,
      reviewerType: 'human'
    });

    const isApproved = feedback.toLowerCase().match(/^(ok|approved|lgtm)$/);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              status: isApproved ? 'approved' : 'needs_revision',
              feedback: feedback,
              sessionId: session.sessionId,
              iterationCount: session.iterationCount,
              reviewerType: 'human',
              message: isApproved
                ? '✅ Human approved! Task complete.'
                : `⚠️ Human feedback: ${feedback}\n\nImprove based on feedback and call request_review again.`
            },
            null,
            2
          )
        }
      ]
    };
  }

  private setupErrorHandling() {
    this.server.onerror = (error) => {
      console.error('[MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  async run(): Promise<void> {
    await this.initialize();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('Pingpong MCP Server running on stdio');
  }
}

// Start server
const server = new PingpongMCPServer();
server.run().catch(console.error);
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors (escalation-server.ts doesn't exist yet, but import should work)

- [ ] **Step 3: Commit MCP server (temporary commit)**

```bash
git add src/index.ts
git commit -m "feat: implement MCP server with review loop logic (WIP - needs escalation server)"
```

---

## Chunk 6: Escalation Server & HTTP API

### Task 10: Implement Escalation Server

**Files:**
- Create: `src/escalation-server.ts`

- [ ] **Step 1: Write escalation server**

```typescript
// src/escalation-server.ts
import express, { Request, Response } from 'express';
import { open } from 'open';
import type { SessionManager } from './session-manager.js';
import type { ReviewSession } from './types.js';

export async function startEscalationServer(
  port: number,
  sessionManager: SessionManager,
  autoOpenBrowser: boolean
): Promise<express.Application> {
  const app = express();

  app.use(express.json());
  app.use(express.static('templates'));

  // HTML page for review
  app.get('/review/:sessionId', (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.sessionId);

    if (!session) {
      return res.status(404).send('Session not found');
    }

    const html = generateReviewPage(session);
    res.send(html);
  });

  // Submit feedback
  app.post('/api/sessions/:sessionId/feedback', (req: Request, res: Response) => {
    const { feedback } = req.body;

    if (!feedback) {
      return res.status(400).json({ error: 'Feedback is required' });
    }

    const session = sessionManager.getSession(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    sessionManager.resolveSession(req.params.sessionId, feedback);

    res.json({ success: true, message: 'Feedback submitted. Agent will continue.' });
  });

  // List all sessions
  app.get('/api/sessions', (req: Request, res: Response) => {
    const sessions = sessionManager.listSessions();
    res.json(
      sessions.map((s) => ({
        sessionId: s.sessionId,
        taskId: s.taskId,
        summary: s.summary,
        status: s.status,
        iterationCount: s.iterationCount,
        reviewerType: s.reviewerType,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt
      }))
    );
  });

  // Get session details
  app.get('/api/sessions/:sessionId', (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json(session);
  });

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: Date.now() });
  });

  // Auto-open browser
  if (autoOpenBrowser) {
    const sessions = sessionManager.listSessions();
    const escalatedSession = sessions.find((s) => s.status === 'escalated');

    if (escalatedSession) {
      const url = `http://127.0.0.1:${port}/review/${escalatedSession.sessionId}`;
      console.error(`[INFO] Opening browser: ${url}`);
      open(url).catch((err) => console.error('[ERROR] Failed to open browser:', err));
    }
  }

  return app;
}

function generateReviewPage(session: ReviewSession): string {
  const createdAt = new Date(session.createdAt).toLocaleString();
  const updatedAt = new Date(session.updatedAt).toLocaleString();

  return `<!DOCTYPE html>
<html>
<head>
  <title>Pingpong Review - ${session.sessionId}</title>
  <style>
    body { font-family: system-ui; max-width: 1200px; margin: 0 auto; padding: 20px; }
    .container { background: #f5f5f5; padding: 20px; border-radius: 8px; }
    h1 { color: #333; }
    .session-info { background: white; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .task-summary { background: white; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .feedback-history { background: white; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .iteration { border-left: 3px solid #007acc; padding-left: 15px; margin: 10px 0; }
    .context-preview details { background: white; padding: 15px; margin: 20px 0; border-radius: 4px; }
    .context-preview pre { background: #f5f5f5; padding: 10px; overflow-x: auto; }
    .human-feedback { background: #fffbf0; padding: 15px; margin: 20px 0; border-radius: 4px; border: 1px solid #ffd700; }
    textarea { width: 100%; padding: 10px; margin: 10px 0; font-family: monospace; }
    .quick-actions button { margin-right: 10px; padding: 8px 16px; cursor: pointer; }
    button[type="submit"] { padding: 10px 20px; background: #007acc; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button[type="submit"]:hover { background: #005a9e; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏓 Pingpong Review Escalation</h1>

    <div class="session-info">
      <h2>Session: ${session.taskId}</h2>
      <p><strong>Status:</strong> Escalated (${session.iterationCount} iterations completed)</p>
      <p><strong>Created:</strong> ${createdAt}</p>
      <p><strong>Updated:</strong> ${updatedAt}</p>
    </div>

    <div class="task-summary">
      <h3>Task Summary</h3>
      <p>${session.summary}</p>
      ${session.details ? `<p><strong>Details:</strong> ${session.details}</p>` : ''}
    </div>

    <div class="feedback-history">
      <h3>Review Feedback History (${session.iterationCount} iterations)</h3>
      <div class="iteration">
        <h4>Iteration 1-${session.iterationCount} - ${session.reviewerType}</h4>
        <p><strong>Status:</strong> ${session.status}</p>
        <p><strong>Feedback:</strong> ${session.feedback || 'No feedback yet'}</p>
        <p><em>${updatedAt}</em></p>
      </div>
    </div>

    <div class="context-preview">
      <h3>Context</h3>
      ${session.prdPath
        ? `<details>
          <summary>PRD (${session.prdPath})</summary>
          <pre>PRD content loaded from ${session.prdPath}</pre>
        </details>`
        : '<p><em>No PRD detected</em></p>'}
      ${session.gitDiff
        ? `<details>
          <summary>Git Diff (${session.gitDiff.length} bytes)</summary>
          <pre>${session.gitDiff.substring(0, 5000)}${session.gitDiff.length > 5000 ? '\n... (truncated)' : ''}</pre>
        </details>`
        : ''}
      ${session.conversationHistory
        ? `<details>
          <summary>Conversation History</summary>
          <pre>${session.conversationHistory}</pre>
        </details>`
        : ''}
    </div>

    <div class="human-feedback">
      <h3>Human Review Required</h3>
      <p>Local LLM reached maximum iterations (${session.iterationCount}). Please review and provide feedback:</p>
      <form id="feedbackForm">
        <textarea name="feedback" rows="6" cols="80" placeholder="Enter your feedback here... Type 'ok', 'approved', or 'lgtm' to approve the work."></textarea>
        <div class="quick-actions">
          <button type="button" data-quick="ok">✅ Approve (ok)</button>
          <button type="button" data-quick="approved">✅ Approve (approved)</button>
          <button type="button" data-quick="lgtm">✅ Approve (lgtm)</button>
        </div>
        <button type="submit">Submit Feedback</button>
      </form>
    </div>
  </div>

  <script>
    document.querySelectorAll('.quick-actions button').forEach(button => {
      button.addEventListener('click', () => {
        const quick = button.getAttribute('data-quick');
        document.querySelector('textarea[name="feedback"]').value = quick;
      });
    });

    document.getElementById('feedbackForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const feedback = document.querySelector('textarea[name="feedback"]').value;

      const response = await fetch('/api/sessions/${session.sessionId}/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback })
      });

      const result = await response.json();
      document.body.innerHTML = '<h1>' + result.message + '</h1>';
    });
  </script>
</body>
</html>`;
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors

- [ ] **Step 3: Commit escalation server**

```bash
git add src/escalation-server.ts
git commit -m "feat: implement Express escalation server with web UI"
```

### Task 10b: Test Escalation Server

**Files:**
- Create: `tests/unit/escalation-server.test.ts`

- [ ] **Step 1: Write escalation server tests**

```typescript
// tests/unit/escalation-server.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { request } from 'express';
import { startEscalationServer } from '../../src/escalation-server.js';
import { SessionManager } from '../../src/session-manager.js';
import type { ReviewSession } from '../../src/types.js';

describe('escalation-server', () => {
  let sessionManager: SessionManager;
  let app: any;
  let testSession: ReviewSession;
  const testPort = 3457;

  beforeEach(async () => {
    sessionManager = new SessionManager('/tmp/test-escalation-server');
    testSession = sessionManager.createSession({
      taskId: 'test-escalation-001',
      summary: 'Test escalation UI'
    });
    sessionManager.updateSession(testSession.sessionId, {
      status: 'escalated',
      feedback: 'Escalated to human',
      reviewerType: 'human'
    });
    app = await startEscalationServer(testPort, sessionManager, false);
  });

  afterEach(async () => {
    const fs = await import('fs/promises');
    await fs.rm('/tmp/test-escalation-server', { recursive: true, force: true });
  });

  it('should return HTML for /review/:sessionId', async () => {
    const response = await request(app).get(`/review/${testSession.sessionId}`);
    expect(response.status).toBe(200);
    expect(response.text).toContain('Pingpong Review Escalation');
    expect(response.text).toContain(testSession.taskId);
    expect(response.text).toContain(testSession.summary);
  });

  it('should return 404 for non-existent session', async () => {
    const response = await request(app).get('/review/nonexistent');
    expect(response.status).toBe(404);
    expect(response.text).toContain('Session not found');
  });

  it('should handle POST /api/sessions/:id/feedback', async () => {
    let resolved = false;
    let feedbackReceived = '';
    sessionManager.setResolveCallback(testSession.sessionId, (feedback: string) => {
      resolved = true;
      feedbackReceived = feedback;
    });

    const response = await request(app)
      .post(`/api/sessions/${testSession.sessionId}/feedback`)
      .send({ feedback: 'Looks good, approved' });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(resolved).toBe(true);
    expect(feedbackReceived).toBe('Looks good, approved');
  });

  it('should return 400 for missing feedback', async () => {
    const response = await request(app)
      .post(`/api/sessions/${testSession.sessionId}/feedback`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Feedback is required');
  });

  it('should list all sessions on GET /api/sessions', async () => {
    const response = await request(app).get('/api/sessions');
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body.length).toBeGreaterThan(0);
    expect(response.body[0]).toHaveProperty('sessionId');
    expect(response.body[0]).toHaveProperty('taskId');
    expect(response.body[0]).toHaveProperty('status');
  });

  it('should return health status on GET /api/health', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.timestamp).toBeDefined();
  });
});
```

- [ ] **Step 2: Install supertest for HTTP testing**

```bash
npm install -D supertest @types/supertest
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
npm test -- tests/unit/escalation-server.test.ts
```

Expected: PASS

- [ ] **Step 4: Commit escalation server tests**

```bash
git add tests/unit/escalation-server.test.ts
git commit -m "test: add escalation server HTTP API tests"
```


---

## Chunk 7: Templates & Documentation

### Task 11: Create Template Files

**Files:**
- Create: `templates/APPEND_SYSTEM.md`
- Create: `templates/AGENTS.md`
- Create: `README.md`

- [ ] **Step 1: Create APPEND_SYSTEM.md template**

```bash
cat > templates/APPEND_SYSTEM.md << 'EOF'
### 3. Review loop via pingpong

After completing all work, you MUST call the `request_review` tool:
- `taskId`: format `[type]-[date]-[seq]` — e.g. `feature-20260314-001`, `fix-20260314-001`, `refactor-20260314-001`
- `summary`: 2–3 sentences covering what changed, why, and any assumptions made
- `conversationHistory` (optional): Include full conversation if it provides important context
- `details` (optional): Any additional technical context

**What pingpong reviews:**
- Your task summary and details
- Project PRD (auto-detected from `./docs/PRD.md`, `./PRD.md`, or `./README.md`)
- Git diff (auto-read: unstaged + staged changes via `git diff HEAD`)
- Conversation history (if provided)
- Built-in comprehensive criteria: correctness, quality, security, performance, maintainability, documentation

**How automated review works:**
Pingpong sends your work to a local LLM (llama.cpp:8080) for thorough evaluation. The local LLM responds with:
- `STATUS: approved` → stop immediately, confirm completion
- `STATUS: needs_revision` → read the feedback, improve your work, call `request_review` again

**Escalation to human (after 5 completed iterations or LLM errors):**
- Web UI opens at `http://127.0.0.1:3456` with full session history
- Human reviews and provides feedback
- `"ok"` / `"approved"` / `"lgtm"` → task complete
- Any other feedback → improve and call `request_review` again

**Hard rules:**
- NEVER finish a task without an approved review
- NEVER skip the review step even if the change seems trivial
- Do not open a new prompt to handle feedback — all iteration stays in the same session
- If no PRD is detected, verify `pingpong.config.json` is configured correctly

**Review iteration:**
- Automated: Up to 5 iterations with local LLM
- After 5: Escalates to human via web UI
- Continue improving until approved (by LLM or human)
EOF
```

- [ ] **Step 2: Create AGENTS.md template**

```bash
cat > templates/AGENTS.md << 'EOF'
# Pingpong Local LLM Review Instructions

You are an expert code reviewer. Your task is to evaluate the agent's work against the project PRD and comprehensive review criteria.

## Review Process

1. **Read the provided context:**
   - Task summary: what the agent did
   - Project PRD: requirements and specifications
   - Git diff: actual code changes
   - Conversation history: context and decisions
   - Built-in review criteria: your evaluation framework

2. **Evaluate systematically:**
   - Correctness: Does it work? Edge cases handled?
   - Code Quality: Idiomatic, clear, maintainable?
   - Security: No vulnerabilities, proper validation?
   - Performance: Efficient, no obvious anti-patterns?
   - Maintainability: Single responsibility, DRY, clear abstractions?
   - Documentation: Docstrings, comments for non-obvious logic?

3. **Check PRD alignment:**
   - Does the implementation match requirements?
   - Are all acceptance criteria met?
   - Any missing features or behaviors?

4. **Provide feedback:**
   - If approved: Output exactly `STATUS: approved` followed by optional praise
   - If needs revision: Output exactly `STATUS: needs_revision` followed by specific, actionable feedback
   - Be specific: what to fix, why it matters, how to fix it
   - Prioritize: critical issues first, minor improvements last

## Response Format

You MUST start your response with either:
```
STATUS: approved
<optional feedback>
```
OR
```
STATUS: needs_revision
<specific feedback on what to fix>
```

## Review Standards

- Be thorough but fair
- Explain why something is wrong, not just that it's wrong
- Suggest concrete improvements
- Recognize good work when you see it
- Consider the agent's constraints (single request, iteration limits)
EOF
```

- [ ] **Step 3: Create README.md**

```bash
cat > README.md << 'EOF'
# Pingpong - Automated Code Review MCP

> Automate code review with your local LLM instead of human review loops

## Overview

Pingpong is an MCP (Model Context Protocol) server that provides automated code review using a local LLM (llama.cpp) instead of human review. Inspired by [copilot-leecher](https://github.com/yosebyte/copilot-leecher), pingpong replaces the human-in-the-loop with an automated review system while maintaining comprehensive code quality standards.

## Key Features

- **Automated Review**: Local LLM reviews against PRD + strict criteria (correctness, quality, security, performance, maintainability, documentation)
- **Zero Premium Request Cost**: All review iterations happen via free MCP tool results
- **Comprehensive Context**: Auto-reads PRD and git diff (unstaged + staged changes)
- **Human Fallback**: Escalates to web UI after 5 iterations or on LLM errors
- **Configurable**: LLM endpoint, PRD paths, review criteria all customizable

## Installation

Copy the text below and paste it into your oh-my-pi (OMP) harness. The LLM will:

1. Clone the pingpong repository
2. Install dependencies (npm install, npm run build)
3. Create `pingpong.config.json` with detected defaults
4. Install `APPEND_SYSTEM.md` at `~/.omp/agent/` (merge or replace existing)
5. Install `AGENTS.md` at `~/.omp/agent/`
6. Configure the MCP server in OMP settings
7. Verify the setup (health check)

---

### Installation Instructions for OMP

1. Clone pingpong: `git clone https://github.com/yourusername/pingpong.git ~/ai/projects/pingpong`
2. Navigate to project: `cd ~/ai/projects/pingpong`
3. Install dependencies: `npm install`
4. Build project: `npm run build`
5. Create config: `cp pingpong.config.example.json pingpong.config.json`
6. Edit config if needed (default: llama.cpp at http://127.0.0.1:8080)
7. Install agent contract:
   - Check if `~/.omp/agent/APPEND_SYSTEM.md` exists
   - If yes, ask user: "Merge with existing APPEND_SYSTEM.md or replace?"
   - If merge: Append section 3 (Review loop via pingpong)
   - If replace or no file: Create full APPEND_SYSTEM.md with pingpong section
8. Install LLM prompt: `cp templates/AGENTS.md ~/.omp/agent/AGENTS.md`
9. Configure MCP in OMP settings (add to MCP servers list)
10. Verify: Restart OMP, check MCP server connects
11. Test: Run a simple task that calls request_review

### Verification

After installation, verify:
- Pingpong MCP server appears in OMP MCP list
- LLM is running: `curl http://127.0.0.1:8080/health`
- Test review: Agent should call request_review successfully
- Check logs: Pingpong should log "Review session created", "Calling LLM", etc.

## Configuration

Create `pingpong.config.json` in your project root:

```json
{
  "llm": {
    "endpoint": "http://127.0.0.1:8080/v1/chat/completions",
    "model": "default",
    "timeout": 1800
  },
  "prd": {
    "autoDetect": true,
    "paths": ["./docs/PRD.md", "./PRD.md", "./README.md"],
    "fallbackPath": null
  },
  "review": {
    "maxIterations": 5,
    "retryOnLlmError": true
  },
  "escalation": {
    "port": 3456,
    "autoOpenBrowser": true
  }
}
```

### Environment Variables

Override config with environment variables:
- `PINGPONG_LLM_ENDPOINT` - Override LLM endpoint
- `PINGPONG_LLM_MODEL` - Override model name
- `PINGPONG_LLM_TIMEOUT` - Override timeout (seconds)
- `PINGPONG_PRD_PATH` - Override PRD path

## Usage

### Agent Contract

Add to your agent contract (APPEND_SYSTEM.md):

```markdown
After completing all work, you MUST call the `request_review` tool:
- `taskId`: format `[type]-[date]-[seq]` (e.g., `feature-20260314-001`)
- `summary`: 2-3 sentences covering what changed, why, and assumptions
- `conversationHistory` (optional): Include full conversation if important
- `details` (optional): Any additional technical context

Then wait for feedback:
- Local LLM reviews against PRD + git diff + strict criteria
- `STATUS: approved` → stop immediately, confirm completion
- `STATUS: needs_revision` → read feedback, improve, call request_review again
- After 5 iterations or LLM errors → web UI opens at localhost:3456 for human review

NEVER finish without an approved review.
```

### Example Agent Workflow

```
User: Implement user authentication with JWT

Agent: [Implements JWT auth]
      request_review({
        taskId: "feature-20260314-001",
        summary: "Implemented JWT authentication with refresh token rotation"
      })

Pingpong: [Calls local LLM with PRD + git diff + criteria]
          Returns: STATUS: needs_revision - Missing rate limiting on login

Agent: [Adds rate limiting]
      request_review({
        taskId: "feature-20260314-001",
        summary: "Added rate limiting to login endpoint"
      })

Pingpong: [Calls local LLM again]
          Returns: STATUS: approved - All security issues addressed

Agent: ✅ Task complete
```

## HTTP API

When escalation server is running (port 3456):

- `GET /api/sessions` - List all sessions
- `GET /api/sessions/:id` - Get session details
- `POST /api/sessions/:id/feedback` - Submit human feedback
- `GET /api/health` - Health check

## Troubleshooting

**MCP Server won't connect:**
- Verify `dist/index.js` exists (run `npm run build`)
- Check absolute path in OMP MCP settings
- Review OMP output panel → MCP Server logs

**LLM connection fails:**
- Verify llama.cpp is running: `curl http://127.0.0.1:8080/health`
- Check endpoint in `pingpong.config.json`
- Verify port 8080 is not in use by another service

**PRD not detected:**
- Check `pingpong.config.json` prd.paths
- Verify PRD file exists at one of the paths
- Set prd.fallbackPath to explicit path

**Git diff fails:**
- Verify project is a git repository
- Check git permissions
- Pingpong will log warning and continue without diff

## Development

```bash
npm install          # Install dependencies
npm run build        # Build TypeScript
npm run dev          # Run MCP server
npm test             # Run tests
npm run watch        # Watch mode
```

## Architecture

- **MCP Server**: Handles `request_review` tool calls
- **LLM Client**: Communicates with llama.cpp
- **Context Gatherers**: PRD locator, Git diff reader
- **Session Manager**: Persists sessions in `/tmp/pingpong-sessions/`
- **Escalation Server**: Express web UI for human review
- **Review Loop Controller**: Iterations, error handling, escalation logic

## License

MIT

## Inspired By

[🧛 Copilot Leecher](https://github.com/yosebyte/copilot-leecher) - Squeeze every drop out of your GitHub Copilot premium requests
EOF
```

- [ ] **Step 4: Commit templates and README**

```bash
git add templates/ README.md
git commit -m "docs: add template files and comprehensive README"
```

---

## Chunk 8: Integration Tests & Final Polish

### Task 12: Write Integration Tests

**Files:**
- Create: `tests/integration/review-flow.test.ts`
- Create: `tests/integration/escalation-flow.test.ts`

- [ ] **Step 1: Write review flow integration test**

```typescript
// tests/integration/review-flow.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import axios from 'axios';

describe('integration: review flow', () => {
  let llmServer: any;
  let mcpServer: any;

  beforeAll(async () => {
    // Start mock LLM server
    llmServer = spawn('node', ['tests/mocks/llm-server.js'], {
      stdio: 'pipe'
    });

    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    if (llmServer) llmServer.kill();
    if (mcpServer) mcpServer.kill();
  });

  it('should increment iteration count across review calls', async () => {
    // Test: Multiple request_review calls for same taskId increment iteration count
    const { SessionManager } = await import('../../src/session-manager.js');
    const manager = new SessionManager('/tmp/test-integration-sessions');

    const session1 = manager.createSession({ taskId: 'test-001', summary: 'First review' });
    expect(session1.iterationCount).toBe(0);

    // Simulate first review iteration
    manager.incrementIteration(session1.sessionId);
    manager.updateSession(session1.sessionId, { status: 'needs_revision', feedback: 'Fix X', reviewerType: 'llm' });

    const session2 = manager.getSession(session1.sessionId);
    expect(session2?.iterationCount).toBe(1);

    // Simulate second review iteration
    manager.incrementIteration(session1.sessionId);
    const session3 = manager.getSession(session1.sessionId);
    expect(session3?.iterationCount).toBe(2);

    // Cleanup
    const fs = await import('fs/promises');
    await fs.rm('/tmp/test-integration-sessions', { recursive: true, force: true });
  });

  it('should trigger escalation after max iterations', async () => {
    // Test: After 5 iterations, escalation should be triggered
    const { SessionManager } = await import('../../src/session-manager.js');
    const manager = new SessionManager('/tmp/test-integration-escalation');
    const config = { review: { maxIterations: 5 } };

    const session = manager.createSession({ taskId: 'test-escalate', summary: 'Test escalation' });

    // Simulate 5 iterations
    for (let i = 0; i < 5; i++) {
      manager.incrementIteration(session.sessionId);
    }

    const updated = manager.getSession(session.sessionId);
    expect(updated?.iterationCount).toBe(5);

    // Check if escalation would be triggered (iteration count >= maxIterations)
    const shouldEscalate = updated!.iterationCount >= config.review.maxIterations;
    expect(shouldEscalate).toBe(true);

    // Cleanup
    const fs = await import('fs/promises');
    await fs.rm('/tmp/test-integration-escalation', { recursive: true, force: true });
  });
```

- [ ] **Step 2: Create mock LLM server for testing**

```bash
mkdir -p tests/mocks
cat > tests/mocks/llm-server.js << 'EOF'
import express from 'express';

const app = express();
app.use(express.json());

app.post('/v1/chat/completions', (req, res) => {
  const { messages } = req.body;

  // Simple mock: approve if "fix" in prompt, otherwise needs revision
  const userPrompt = messages[messages.length - 1].content;

  if (userPrompt.includes('iteration 6') || userPrompt.includes('escalated')) {
    res.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'STATUS: approved'
          }
        }
      ]
    });
  } else {
    res.json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'STATUS: needs_revision\n\nFix security issue and add rate limiting.'
          }
        }
      ]
    });
  }
});

app.listen(8081, () => console.log('Mock LLM server on port 8081'));
EOF
```

- [ ] **Step 3: Commit integration tests**

```bash
git add tests/integration/ tests/mocks/
git commit -m "test: add integration tests for review and escalation flows"
```

---

### Task 13: Final Build & Test

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 2: Build project**

```bash
npm run build
```

Expected: No compilation errors

- [ ] **Step 3: Verify MCP server starts**

```bash
node dist/index.js &
PID=$!
sleep 2
kill $PID
```

Expected: Server starts without errors

- [ ] **Step 4: Create final commit**

```bash
git add .
git commit -m "chore: final build verification and polish"
```

---

## Chunk 9: Installation & Verification

### Task 14: Create Installation Script

**Files:**
- Create: `scripts/install.sh`

- [ ] **Step 1: Write installation script**

```bash
cat > scripts/install.sh << 'EOF'
#!/bin/bash
set -e

INSTALL_DIR="$HOME/ai/projects/pingpong"
OMP_AGENT_DIR="$HOME/.omp/agent"

echo "🏓 Pingpong Installation Script"
echo "================================"

# Check if llama.cpp is running
echo "Checking llama.cpp..."
if curl -s http://127.0.0.1:8080/health > /dev/null; then
  echo "✅ llama.cpp detected at http://127.0.0.1:8080"
else
  echo "⚠️  Warning: llama.cpp not detected at http://127.0.0.1:8080"
  echo "   Please start llama.cpp before using pingpong"
fi

# Install dependencies
echo "Installing dependencies..."
cd "$INSTALL_DIR"
npm install

# Build project
echo "Building project..."
npm run build

# Create config
echo "Creating config..."
if [ ! -f "pingpong.config.json" ]; then
  cp pingpong.config.example.json pingpong.config.json
  echo "✅ Created pingpong.config.json"
else
  echo "ℹ️  pingpong.config.json already exists, skipping"
fi

# Install agent contract
echo "Installing agent contract..."
if [ -f "$OMP_AGENT_DIR/APPEND_SYSTEM.md" ]; then
  echo "APPEND_SYSTEM.md already exists at $OMP_AGENT_DIR/APPEND_SYSTEM.md"
  echo "Options:"
  echo "  1) Merge - Append pingpong section to existing file"
  echo "  2) Replace - Replace with pingpong version"
  echo "  3) Skip - Keep existing file"
  read -p "Choose (1/2/3): " choice

  case $choice in
    1)
      echo "" >> "$OMP_AGENT_DIR/APPEND_SYSTEM.md"
      cat templates/APPEND_SYSTEM.md >> "$OMP_AGENT_DIR/APPEND_SYSTEM.md"
      echo "✅ Merged APPEND_SYSTEM.md"
      ;;
    2)
      cp templates/APPEND_SYSTEM.md "$OMP_AGENT_DIR/APPEND_SYSTEM.md"
      echo "✅ Replaced APPEND_SYSTEM.md"
      ;;
    3)
      echo "ℹ️  Skipped APPEND_SYSTEM.md installation"
      ;;
    *)
      echo "Invalid choice, skipping"
      ;;
  esac
else
  mkdir -p "$OMP_AGENT_DIR"
  cp templates/APPEND_SYSTEM.md "$OMP_AGENT_DIR/APPEND_SYSTEM.md"
  echo "✅ Installed APPEND_SYSTEM.md"
fi

# Install LLM prompt
echo "Installing LLM prompt..."
cp templates/AGENTS.md "$OMP_AGENT_DIR/AGENTS.md"
echo "✅ Installed AGENTS.md"

# Verify installation
echo ""
echo "Verifying installation..."
if [ -f "dist/index.js" ]; then
  echo "✅ Build successful"
else
  echo "❌ Build failed"
  exit 1
fi

echo ""
echo "🎉 Installation complete!"
echo ""
echo "Next steps:"
echo "  1. Configure MCP in your OMP settings:"
echo "     Add pingpong to MCP servers list:"
echo '     {"command": "node", "args": ["'"$INSTALL_DIR"'/dist/index.js"]}'
echo "  2. Restart OMP"
echo "  3. Test with a simple task that calls request_review"
echo ""
echo "For troubleshooting, see: $INSTALL_DIR/README.md"
EOF

chmod +x scripts/install.sh
```

- [ ] **Step 2: Commit installation script**

```bash
git add scripts/install.sh
git commit -m "chore: add installation script for automated setup"
```

---

### Task 15: Create Release Checklist

- [ ] **Step 1: Create RELEASE_CHECKLIST.md**

```bash
cat > RELEASE_CHECKLIST.md << 'EOF'
# Pingpong Release Checklist

## Pre-Release

- [ ] All tests pass (`npm test`)
- [ ] TypeScript compiles without errors (`npm run build`)
- [ ] README.md is complete and accurate
- [ ] PRD.md is up to date
- [ ] Installation script tested on fresh system
- [ ] Example config provided (pingpong.config.example.json)
- [ ] Templates complete (APPEND_SYSTEM.md, AGENTS.md)

## Testing

- [ ] Unit tests pass (80%+ coverage)
- [ ] Integration tests pass
- [ ] Manual testing with real llama.cpp instance
- [ ] Escalation UI tested in browser
- [ ] Config loading verified
- [ ] PRD detection tested
- [ ] Git diff reading tested
- [ ] LLM communication tested

## Documentation

- [ ] README.md installation instructions clear
- [ ] Configuration options documented
- [ ] Environment variables documented
- [ ] HTTP API documented
- [ ] Troubleshooting guide complete
- [ ] Agent contract examples provided

## Release

- [ ] Git tag created (`git tag -a v1.0.0 -m "Release v1.0.0"`)
- [ ] Tag pushed to remote (`git push origin v1.0.0`)
- [ ] GitHub release created with changelog
- [ ] npm package published (if publishing to npm)

## Post-Release

- [ ] Monitor issues/bugs
- [ ] Gather user feedback
- [ ] Plan next iteration
EOF
```

- [ ] **Step 2: Commit release checklist**

```bash
git add RELEASE_CHECKLIST.md
git commit -m "docs: add release checklist"
```

---

## Completion

### Task 16: Final Verification

- [ ] **Step 1: Run all tests one final time**

```bash
npm test
```

- [ ] **Step 2: Verify all files exist**

```bash
ls -la src/
ls -la templates/
ls -la tests/
ls -la scripts/
```

- [ ] **Step 3: Create final commit**

```bash
git add .
git commit -m "chore: implementation complete - ready for release"
```

- [ ] **Step 4: Create git tag**

```bash
git tag -a v1.0.0 -m "Pingpong v1.0.0 - Automated Code Review MCP"
```

---

## Implementation Complete! 🎉

All tasks are complete. Pingpong is ready for:

1. **Development**: Use in OMP with local llama.cpp instance
2. **Testing**: Run test suite, manual testing with real workflows
3. **Release**: Follow RELEASE_CHECKLIST.md for public release

### Next Steps

1. Run the installation script: `bash scripts/install.sh`
2. Configure MCP in OMP settings
3. Test with a simple task that calls `request_review`
4. Iterate based on feedback
5. Prepare for release following checklist

### Key Achievements

✅ MCP server with `request_review` tool
✅ Automated LLM review with comprehensive criteria
✅ PRD auto-detection with fallbacks
✅ Git diff reading (unstaged + staged)
✅ Session management with persistence
✅ Escalation to human web UI (after 5 iterations)
✅ HTTP API for monitoring
✅ Configurable via JSON and environment variables
✅ Comprehensive test coverage
✅ Complete documentation and installation guide
EOF

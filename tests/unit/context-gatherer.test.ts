import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, accessSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve, dirname } from 'path';

// Mock execSync to control git diff output
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

// Mock homedir
vi.mock('os', () => ({
  homedir: vi.fn(() => '/tmp/testhome/testuser'),
}));

describe('context-gatherer', () => {
  const testDir = '/tmp/pingpong-test';
  const testHomeDir = '/tmp/testhome/testuser';

  beforeEach(() => {
    // Setup test directory
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    
    // Ensure the test directory is clean
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    
    // Setup test home directory
    if (!existsSync(testHomeDir)) {
      mkdirSync(testHomeDir, { recursive: true, mode: 0o755 });
    }
  });

  afterEach(() => {
    // Cleanup test directory
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    
    // Cleanup test home directory
    try {
      rmSync(testHomeDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    
    vi.clearAllMocks();
  });

  describe('detectPRD', () => {
    it('finds PRD.md in docs subdirectory', async () => {
      const docsDir = `${testDir}/docs`;
      mkdirSync(docsDir, { recursive: true });
      const prdPath = `${docsDir}/PRD.md`;
      writeFileSync(prdPath, '# Test PRD');
      
      const { detectPRD } = await import('../../src/context-gatherer.js');
      const result = detectPRD();
      
      expect(result).toBe(resolve(prdPath));
    });

    it('finds PRD.md in current directory when no docs/PRD exists', async () => {
      const prdPath = `${testDir}/PRD.md`;
      writeFileSync(prdPath, '# Test PRD');
      
      const { detectPRD } = await import('../../src/context-gatherer.js');
      const result = detectPRD();
      
      expect(result).toBe(resolve(prdPath));
    });

    it('finds README.md when no PRD exists', async () => {
      const readmePath = `${testDir}/README.md`;
      writeFileSync(readmePath, '# Test README');
      
      const { detectPRD } = await import('../../src/context-gatherer.js');
      const result = detectPRD();
      
      expect(result).toBe(resolve(readmePath));
    });

    it('returns null when no PRD or README exists', async () => {
      const { detectPRD } = await import('../../src/context-gatherer.js');
      const result = detectPRD();
      
      expect(result).toBeNull();
    });

    it('prefers docs/PRD.md over PRD.md', async () => {
      const docsDir = `${testDir}/docs`;
      mkdirSync(docsDir, { recursive: true });
      const prdInDocsPath = `${docsDir}/PRD.md`;
      const prdInRootPath = `${testDir}/PRD.md`;
      writeFileSync(prdInDocsPath, '# Test PRD in docs');
      writeFileSync(prdInRootPath, '# Test PRD in root');
      
      const { detectPRD } = await import('../../src/context-gatherer.js');
      const result = detectPRD();
      
      expect(result).toBe(resolve(prdInDocsPath));
    });

    it('prefers PRD.md over README.md', async () => {
      const prdPath = `${testDir}/PRD.md`;
      const readmePath = `${testDir}/README.md`;
      writeFileSync(prdPath, '# Test PRD');
      writeFileSync(readmePath, '# Test README');
      
      const { detectPRD } = await import('../../src/context-gatherer.js');
      const result = detectPRD();
      
      expect(result).toBe(resolve(prdPath));
    });
  });

  describe('loadPRD', () => {
    it('loads PRD content successfully', async () => {
      const prdPath = `${testDir}/PRD.md`;
      const content = '# Test PRD\n\nThis is a test PRD.';
      writeFileSync(prdPath, content);
      
      const { loadPRD } = await import('../../src/context-gatherer.js');
      const result = loadPRD();
      
      expect(result).toBe(content);
    });

    it('returns null when no PRD found', async () => {
      const { loadPRD } = await import('../../src/context-gatherer.js');
      const result = loadPRD();
      
      expect(result).toBeNull();
    });

    it('truncates large files (> 100KB) with warning', async () => {
      // Create content larger than 100KB
      const prdPath = `${testDir}/PRD.md`;
      const largeContent = '# Test PRD\n\n' + 'x'.repeat(110 * 1024); // 110KB
      writeFileSync(prdPath, largeContent);
      
      const { loadPRD } = await import('../../src/context-gatherer.js');
      const result = loadPRD();
      
      expect(result).not.toBe(largeContent);
      // Check warning message is present and correct length
      expect(result?.length).toBe(100 * 1024 + 68); // 100KB + warning message length
      expect(result).toContain('[WARNING: This file was truncated to 100KB]');
      expect(result).toContain('Original size: 110KB]');
    });

    it('loads file in docs directory', async () => {
      const docsDir = `${testDir}/docs`;
      mkdirSync(docsDir, { recursive: true });
      const prdPath = `${docsDir}/PRD.md`;
      const content = '# Test PRD in docs';
      writeFileSync(prdPath, content);
      
      const { loadPRD } = await import('../../src/context-gatherer.js');
      const result = loadPRD();
      
      expect(result).toBe(content);
    });
  });

  describe('loadGitDiff', () => {
    it('returns empty string when not in git repo', async () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        throw new Error('Not a git repository');
      });

      const { loadGitDiff } = await import('../../src/context-gatherer.js');
      const result = loadGitDiff();
      
      expect(result).toBe('');
    });

    it('loads unstaged changes when git repo exists', async () => {
      const mockDiff = 'diff --git a/file.txt b/file.txt\n-index 123..456\n+line1\n-line2';
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --git-dir') {
          return ''; // Valid git repo
        }
        if (cmd === 'git diff HEAD') {
          return mockDiff;
        }
        throw new Error('Command not mocked');
      });

      const { loadGitDiff } = await import('../../src/context-gatherer.js');
      const result = loadGitDiff();
      
      expect(result).toBe(mockDiff);
    });

    it('combines unstaged and staged changes', async () => {
      const unstaged = 'diff --git a/file.txt b/file.txt\n-index 123..456\n+line1';
      const staged = 'diff --git a/file2.txt b/file2.txt\n-index abc..def\n+line2';
      
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --git-dir') {
          return ''; // Valid git repo
        }
        if (cmd === 'git diff HEAD') {
          return unstaged;
        }
        if (cmd === 'git diff --cached') {
          return staged;
        }
        throw new Error('Command not mocked');
      });

      const { loadGitDiff } = await import('../../src/context-gatherer.js');
      const result = loadGitDiff();
      
      expect(result).toContain(unstaged);
      expect(result).toContain(staged);
    });

    it('truncates large git diff realistically and appends warning', async () => {
      // Construct realistic git diff header per real output
      const header = 'diff --git a/file.txt b/file.txt\nindex abc..def 1234\n--- a/file.txt\n+++ b/file.txt\n';
      // Body ensures diff is longer than MAX_FILE_SIZE (100KB)
      const body = '+x'.repeat(110 * 1024); // Make body big enough for test
      const largeDiff = header + body;
      // Mock execSync: git rev-parse returns '', git diff HEAD returns largeDiff, git diff --cached returns ''
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === 'git rev-parse --git-dir') return '';
        if (cmd === 'git diff HEAD') return largeDiff;
        if (cmd === 'git diff --cached') return '';
        throw new Error('Command not mocked');
      });
      const { loadGitDiff } = await import('../../src/context-gatherer.js');
      const result = loadGitDiff();
      const warning = '\n\n[WARNING: This git diff was truncated to 100KB. Original size: 110KB.]';
      const truncated = largeDiff.slice(0, 100 * 1024);
      // Assert length is exactly truncated content + warning
      expect(result.length).toBe(100 * 1024 + warning.length);
      // Assert header is present and at start
      expect(result.startsWith(header)).toBe(true);
      // Assert tail is present: last chars of truncated diff body
      expect(result.slice(header.length, header.length + 10)).toBe(body.slice(0, 10));
      // Assert warning is appended
      expect(result.endsWith(warning)).toBe(true);
      // Assert warning substrings are found
      expect(result).toContain('[WARNING: This git diff was truncated to 100KB]');
      expect(result).toContain('Original size: 110KB]');
    });
  });

  describe('loadAGENTS', () => {
    it('loads LLAMACPP.md from default location', async () => {
      const agentsPath = '/tmp/testhome/testuser/.omp/agent/LLAMACPP.md';
      const content = '# Agent Contract\n\nThis is the agent contract.';
      
      // Create the directory and file
      const dirPath = dirname(agentsPath);
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(agentsPath, content);

      const { loadAGENTS } = await import('../../src/context-gatherer.js');
      const result = loadAGENTS();
      
      expect(result).toBe(content);
    });

    it('returns null when LLAMACPP.md not found', async () => {
      // Make sure the directory doesn't exist
      const agentsPath = '/tmp/testhome/testuser/.omp/agent/LLAMACPP.md';
      const dirPath = dirname(agentsPath);
      try {
        rmSync(dirPath, { recursive: true, force: true });
      } catch {
        // Ignore if doesn't exist
      }

      const { loadAGENTS } = await import('../../src/context-gatherer.js');
      const result = loadAGENTS();
      
      expect(result).toBeNull();
    });
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';

vi.mock('../../src/context-gatherer.js', () => ({
  loadPRD: vi.fn(),
  loadGitDiff: vi.fn(),
  loadAGENTS: vi.fn()
}));

describe('llm-prompt', () => {
  const testDir = '/tmp/pingpong-test';
  const testDiff = 'diff --git a/test.txt b/test.txt\n+line1\n-line2';

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    vi.resetAllMocks();
  });

  describe('buildReviewPrompt', () => {
    it('builds prompt with all required sections', async () => {
      const mockPRD = '# Test PRD\n\nThis is a test project.';
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        null,
        [],
        'task-123',
        'Test task',
        'Test details'
      );

      expect(prompt).toContain('# PROJECT REQUIREMENTS DOCUMENT (PRD)');
      expect(prompt).toContain('# GIT DIFF');
      expect(prompt).toContain('# TASK DETAILS');
      expect(prompt).toContain('# REVIEW CRITERIA');
      expect(prompt).toContain('Test PRD');
      expect(prompt).toContain(testDiff);
      expect(prompt).toContain('task-123');
      expect(prompt).toContain('Test task');
    });

    it('includes session history when provided', async () => {
      const mockPRD = '# Test PRD';
      const history = ['First message', 'Second message'];
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        null,
        history,
        'task-123',
        'Test task'
      );

      expect(prompt).toContain('# SESSION HISTORY');
      expect(prompt).toContain('First message');
      expect(prompt).toContain('Second message');
    });

    it('excludes session history section when empty', async () => {
      const mockPRD = '# Test PRD';
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        null,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).not.toContain('# SESSION HISTORY');
    });

    it('excludes git diff section when empty', async () => {
      const mockPRD = '# Test PRD';
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue('');
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        '',
        null,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).not.toContain('# GIT DIFF');
    });

    it('includes LLAMACPP.md when provided', async () => {
      const mockPRD = '# Test PRD';
      const mockAgents = '# Agent Contract\n\nThis is the agent contract.';
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(mockAgents);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        mockAgents,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).toContain('# AGENT CONTRACT (LLAMACPP.md)');
      expect(prompt).toContain('Agent Contract');
    });

    it('excludes PRD section when null', async () => {
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(null);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        null,
        testDiff,
        null,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).not.toContain('# PROJECT REQUIREMENTS DOCUMENT (PRD)');
      expect(prompt).toContain('# GIT DIFF');
    });

    it('includes task details when provided', async () => {
      const mockPRD = '# Test PRD';
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        null,
        undefined,
        'task-123',
        'Test task',
        'Detailed task description with more information'
      );

      expect(prompt).toContain('Detailed task description with more information');
    });

    it('excludes task details section when not provided', async () => {
      const mockPRD = '# Test PRD';
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        null,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).not.toContain('## Details');
    });

    it('includes review criteria section', async () => {
      const mockPRD = '# Test PRD';
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        null,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).toContain('# REVIEW CRITERIA');
      expect(prompt).toContain('"status": "approved" | "needs_revision" | "escalated"');
      expect(prompt).toContain('feedback');
    });

    it('truncates large PRD content', async () => {
      // Create PRD content larger than 25KB
      const largeContent = '# Test PRD\n\n' + 'x'.repeat(30 * 1024);
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(largeContent);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        largeContent,
        testDiff,
        null,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).toContain('[WARNING: This section was truncated to 25KB.');
      expect(prompt).toContain('Original size: 30KB.]');
    });

    it('truncates large git diff content', async () => {
      const largeDiff = 'diff --git a/file.txt b/file.txt\n' + 'x'.repeat(30 * 1024);
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue('# Test PRD');
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(largeDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        '# Test PRD',
        largeDiff,
        null,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).toContain('[WARNING: This section was truncated to 25KB.');
      expect(prompt).toContain('Original size: 30KB.]');
    });

    it('truncates large session history', async () => {
      const mockPRD = '# Test PRD';
      const largeHistory = Array.from({ length: 100 }, (_, i) => `Message ${i}: ` + 'x'.repeat(1024));
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        null,
        largeHistory,
        'task-123',
        'Test task'
      );

      expect(prompt).toContain('[WARNING: This section was truncated to 25KB.');
      expect(prompt).toContain('Original size: 101KB.]');
    });

    it('truncates large LLAMACPP.md content', async () => {
      const mockPRD = '# Test PRD';
      const largeAgents = '# Agent Contract\n\n' + 'x'.repeat(30 * 1024);
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(largeAgents);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        largeAgents,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).toContain('[WARNING: This section was truncated to 25KB.');
      expect(prompt).toContain('Original size: 30KB.]');
    });

    it('separates sections with delimiters', async () => {
      const mockPRD = '# Test PRD';
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(mockPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(null);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        mockPRD,
        testDiff,
        null,
        undefined,
        'task-123',
        'Test task'
      );

      expect(prompt).toContain('='.repeat(60));
    });
  });

  describe('buildReviewPrompt integration with context-gatherer', () => {
    it('integrates with loadPRD, loadGitDiff, and loadAGENTS', async () => {
      const testPRD = '# Test Project\n\nProject description here.';
      const testAgents = '# Agent Contract\n\nReview the code carefully.';
      
      vi.mocked((await import('../../src/context-gatherer.js')).loadPRD).mockReturnValue(testPRD);
      vi.mocked((await import('../../src/context-gatherer.js')).loadGitDiff).mockReturnValue(testDiff);
      vi.mocked((await import('../../src/context-gatherer.js')).loadAGENTS).mockReturnValue(testAgents);

      const { buildReviewPrompt } = await import('../../src/llm-prompt.js');
      
      const prompt = buildReviewPrompt(
        testPRD,
        testDiff,
        testAgents,
        undefined,
        'task-456',
        'Test integration'
      );

      expect(prompt).toContain('# PROJECT REQUIREMENTS DOCUMENT (PRD)');
      expect(prompt).toContain('Test Project');
      expect(prompt).toContain('# GIT DIFF');
      expect(prompt).toContain(testDiff);
      expect(prompt).toContain('# AGENT CONTRACT (LLAMACPP.md)');
      expect(prompt).toContain('Agent Contract');
    });
  });
});

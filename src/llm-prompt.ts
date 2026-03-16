import { loadPRD, loadGitDiff, loadAGENTS } from './context-gatherer.js';

const MAX_SECTION_LENGTH = 25 * 1024; // 25KB per section

/**
 * Truncate content to max length, appending warning if truncated
 */
function truncateContent(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  
  const truncated = content.slice(0, maxLength);
  const originalSize = Math.round(content.length / 1024);
  const warning = `\n\n[WARNING: This section was truncated to ${maxLength / 1024}KB. Original size: ${originalSize}KB.]`;
  return truncated + warning;
}

/**
 * Build the complete review prompt from all context
 */
export function buildReviewPrompt(
  prd: string | null,
  gitDiff: string,
  agentsContent: string | null,
  sessionHistory: string[] | undefined,
  taskId: string,
  summary: string,
  details?: string
): string {
  const sections: string[] = [];

  // 1. PRD Section
  const prdSection = buildPRDSection(prd);
  if (prdSection) {
    sections.push(prdSection);
  }

  // 2. Git Diff Section
  const gitDiffSection = buildGitDiffSection(gitDiff);
  if (gitDiffSection) {
    sections.push(gitDiffSection);
  }

  // 3. AGENTS.md Section
  const agentsSection = buildAGENTSSection(agentsContent);
  if (agentsSection) {
    sections.push(agentsSection);
  }

  // 4. Task Details Section
  const taskSection = buildTaskSection(taskId, summary, details);
  if (taskSection) {
    sections.push(taskSection);
  }

  // 5. Session History Section
  const historySection = buildHistorySection(sessionHistory);
  if (historySection) {
    sections.push(historySection);
  }

  // 6. Review Criteria Section (always included)
  sections.push(buildReviewCriteriaSection());

  return sections.join('\n\n' + '='.repeat(60) + '\n\n');
}

/**
 * Build PRD section
 */
function buildPRDSection(prd: string | null): string | null {
  if (!prd) {
    return null;
  }

  const truncated = truncateContent(prd, MAX_SECTION_LENGTH);
  return `# PROJECT REQUIREMENTS DOCUMENT (PRD)\n\n${truncated}`;
}

/**
 * Build Git Diff section
 */
function buildGitDiffSection(gitDiff: string): string | null {
  if (!gitDiff.trim()) {
    return null;
  }

  const truncated = truncateContent(gitDiff, MAX_SECTION_LENGTH);
  return `# GIT DIFF\n\n${truncated}`;
}

/**
 * Build AGENTS.md section
 */
function buildAGENTSSection(agentsContent: string | null): string | null {
  if (!agentsContent) {
    return null;
  }

  const truncated = truncateContent(agentsContent, MAX_SECTION_LENGTH);
  return `# AGENT CONTRACT (AGENTS.md)\n\n${truncated}`;
}

/**
 * Build Task Details section
 */
function buildTaskSection(taskId: string, summary: string, details?: string): string {
  let section = `# TASK DETAILS\n\n## Task ID\n${taskId}\n\n## Summary\n${summary}`;
  
  if (details) {
    section += `\n\n## Details\n${details}`;
  }
  
  return section;
}

/**
 * Build Session History section
 */
function buildHistorySection(sessionHistory: string[] | undefined): string | null {
  if (!sessionHistory || !Array.isArray(sessionHistory) || sessionHistory.length === 0) {
    return null;
  }

  const history = sessionHistory.join('\n\n');
  const truncated = truncateContent(history, MAX_SECTION_LENGTH);
  return `# SESSION HISTORY\n\n${truncated}`;
}

/**
 * Build Review Criteria section
 */
function buildReviewCriteriaSection(): string {
  return `# REVIEW CRITERIA

Please review the code changes and provide feedback. Your response MUST be a JSON object with the following structure:

{
  "status": "approved" | "needs_revision" | "escalated",
  "feedback": "Your detailed feedback here"
}

## Status Values

- "approved": Code changes are good to merge
- "needs_revision": Code needs improvements before merging
- "escalated": Issue requires human review

## Feedback Guidelines

Provide specific, actionable feedback when status is "needs_revision" or "escalated":
- Identify specific line numbers or code sections
- Explain why something needs to change
- Suggest concrete improvements
- Mention security, performance, or maintainability concerns
`;
}

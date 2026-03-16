import { readFileSync, existsSync, accessSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, resolve, dirname } from 'path';
import { homedir } from 'os';

const MAX_FILE_SIZE = 100 * 1024; // 100KB

/**
 * Detect PRD file from common paths
 * Returns the path to the PRD file if found, null otherwise
 * Uses current working directory by default, but accepts a custom base path for testing
 */
export function detectPRD(basePath?: string): string | null {
  const commonPaths = [
    './docs/PRD.md',
    './PRD.md',
    './README.md',
  ];

  for (const path of commonPaths) {
    const fullPath = basePath ? resolve(basePath, path) : resolve(path);
    if (existsSync(fullPath)) {
      try {
        accessSync(fullPath, 4); // Check if readable
        return resolve(fullPath);
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Load PRD content with truncation
 * Returns the content or null if not found
 * Truncates if > 100KB and appends a note
 */
export function loadPRD(basePath?: string): string | null {
  const prdPath = detectPRD(basePath);
  
  if (!prdPath) {
    return null;
  }

  try {
    const content = readFileSync(prdPath, 'utf-8');
    
    if (content.length > MAX_FILE_SIZE) {
      const truncated = content.slice(0, MAX_FILE_SIZE);
      const originalSize = Math.round(content.length / 1024);
      const warning = `\n\n[WARNING: This file was truncated to ${MAX_FILE_SIZE / 1024}KB. Original size: ${originalSize}KB.]`;
      return truncated + warning;
    }
    
    return content;
  } catch (error) {
    console.error(`[WARN] Failed to load PRD from ${prdPath}:`, error);
    return null;
  }
}

/**
 * Load git diff (unstaged + staged)
 * Returns empty string if git repo not found
 * Truncates if > 100KB and appends a note
 */
export function loadGitDiff(): string {
  try {
    // Check if we're in a git repository
    execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    
    // Get unstaged changes
    let diff = '';
    try {
      diff = execSync('git diff HEAD', { encoding: 'utf-8' }).trim();
    } catch {
      // No git or no diff available
    }
    
    // Get staged changes
    let stagedDiff = '';
    try {
      stagedDiff = execSync('git diff --cached', { encoding: 'utf-8' }).trim();
    } catch {
      // No staged changes
    }
    
    // Combine diffs
    let fullDiff = diff;
    if (stagedDiff) {
      fullDiff = fullDiff ? `${fullDiff}\n\n${stagedDiff}` : stagedDiff;
    }
    
    // Check size and truncate if needed
    if (fullDiff.length > MAX_FILE_SIZE) {
      const truncated = fullDiff.slice(0, MAX_FILE_SIZE);
      const originalSize = Math.round(fullDiff.length / 1024);
      const warning = `\n\n[WARNING: This git diff was truncated to ${MAX_FILE_SIZE / 1024}KB. Original size: ${originalSize}KB.]`;
      return truncated + warning;
    }
    
    return fullDiff;
  } catch {
    // Not a git repository or git not available
    return '';
  }
}

/**
 * Load agent contract from ~/.omp/agent/AGENTS.md
 * Returns the content or null if not found
 */
export function loadAGENTS(): string | null {
  const agentsPath = join(homedir(), '.omp', 'agent', 'AGENTS.md');
  
  if (!existsSync(agentsPath)) {
    return null;
  }
  
  try {
    const content = readFileSync(agentsPath, 'utf-8');
    return content;
  } catch (error) {
    console.error(`[WARN] Failed to load AGENTS.md from ${agentsPath}:`, error);
    return null;
  }
}

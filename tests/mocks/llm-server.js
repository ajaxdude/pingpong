import express from 'express';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = resolve(__filename, '..');

const app = express();
app.use(express.json());

// Response mode: 'approve', 'revision', or 'cycle'
const RESPONSE_MODE = process.env.LLM_RESPONSE_MODE || 'cycle';
let cycleCount = 0;

// GET /api/health - Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    server: 'pingpong-mock-llm',
    mode: RESPONSE_MODE,
  });
});

// POST /api/chat - Mock LLM chat endpoint
app.post('/api/chat', (req, res) => {
  const { model, messages } = req.body || {};

  // Determine response based on mode
  let status;
  let feedback;

  if (RESPONSE_MODE === 'approve') {
    status = 'approved';
    feedback = 'Code looks good! All changes are approved.';
  } else if (RESPONSE_MODE === 'revision') {
    status = 'needs_revision';
    feedback = 'Please add more tests and fix the linting issues.';
  } else if (RESPONSE_MODE === 'cycle') {
    // Alternate between approved and needs_revision
    cycleCount++;
    if (cycleCount % 2 === 0) {
      status = 'approved';
      feedback = 'All issues have been addressed. Approved!';
    } else {
      status = 'needs_revision';
      feedback = `Iteration ${cycleCount}: Please address the feedback from previous review.`;
    }
  } else {
    // Default to approved
    status = 'approved';
    feedback = 'Code looks good! All changes are approved.';
  }

  const response = {
    choices: [
      {
        message: {
          role: 'assistant',
          content: JSON.stringify({ status, feedback }),
        },
        finish_reason: 'stop',
      },
    ],
  };

  res.json(response);
});

// Start server
const PORT = process.env.PORT || 11434;
const server = app.listen(PORT, () => {
  console.log(`[Mock LLM Server] Running on http://localhost:${PORT}`);
  console.log(`[Mock LLM Server] Health check: http://localhost:${PORT}/api/health`);
  console.log(`[Mock LLM Server] Response mode: ${RESPONSE_MODE}`);
});

// Export for testing
export const getServer = () => server;
export const stopServer = () => new Promise((resolve) => server.close(resolve));
export default app;

// Test script to test dynamic model routing
import { SessionManager } from './dist/session-manager.js';
import { loadConfig } from './dist/config.js';
import { createReviewLoop } from './dist/review-loop.js';
import { initializeModelRouter, modelRouter } from './dist/router.js';
import { join } from 'path';

async function testDynamicRouting() {
  console.log('🔧 Testing dynamic model routing...');
  
  try {
    const projectRoot = process.cwd();
    const sessionDir = join(projectRoot, '.pingpong', 'sessions');
    
    console.log('📁 Session directory:', sessionDir);
    
    const sessionManager = new SessionManager(sessionDir);
    console.log('✅ Session manager created');
    
    const config = await loadConfig(projectRoot);
    console.log('✅ Configuration loaded');

    // --- Customizations for this test ---
    config.router.enabled = true;
    // Assuming llama-swap is running on localhost:8088
    config.router.litellmBaseUrl = 'http://localhost:8080'; 
    console.log('🔌 Router enabled, pointing to', config.router.litellmBaseUrl);

    // Initialize the router with the modified config
    initializeModelRouter(config);
    console.log('✅ Model router initialized');

    // Wait for the initial model list refresh
    console.log('⏳ Waiting for model list refresh...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Give it a moment to fetch

    // Mock context gatherer
    const contextGatherer = {
      async gather(taskId, summary, details) {
        return {
          prd: "This is a test PRD.",
          gitDiff: "diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1,1 +1,1 @@\n-console.log('hello');\n+console.log('hello world');",
          agentsContent: null,
          sessionHistory: []
        };
      }
    };

    // Create review loop
    const reviewLoop = createReviewLoop(sessionManager, config);
    console.log('✅ Review loop created');
    
    // Create a test session
    const session = sessionManager.createSession({
      taskId: 'routing-test-001',
      summary: 'Dynamic routing test',
      details: 'This test checks if the model router can fetch models from llama-swap and select one.'
    });
    
    console.log('📝 Starting review for session:', session.id);
    
    const startTime = Date.now();
    const result = await reviewLoop.startReview(
      session.taskId,
      session.summary,
      session.details,
      []
    );
    
    const duration = Date.now() - startTime;
    console.log('✅ Review completed in', duration, 'ms');
    console.log('📊 Result:', JSON.stringify(result, null, 2));

  } catch (error) {
    console.error('❌ Error in dynamic routing test:', error);
  }
}

testDynamicRouting().catch(console.error);

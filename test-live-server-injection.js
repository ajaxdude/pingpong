// Test script to inject a review into the running server's context
import { initializeServer, handleRequestReview } from './dist/mcp.js';

async function testLiveServer() {
  console.log('🔧 Initializing server components in memory...');
  // This will create the sessionManager and reviewLoop instances
  await initializeServer();
  console.log('✅ Server components initialized.');

  console.log('🚀 Injecting a new review request...');
  const reviewInput = {
    taskId: 'live-server-test-002',
    summary: 'A test review injected into the live server.',
    details: 'This review should appear in the web UI at http://127.0.0.1:3458/review-requests',
    conversationHistory: [],
  };

  try {
    const result = await handleRequestReview(reviewInput);
    console.log('✅ Review request processed.');
    console.log('📊 Result:', JSON.stringify(result, null, 2));
    console.log('\n\n➡️ Please check http://127.0.0.1:3458/review-requests to see the new session.');
  } catch (error) {
    console.error('❌ Error during review request:', error);
  }
}

testLiveServer().catch(console.error);

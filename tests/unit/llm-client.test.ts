import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');

describe('llm-client', () => {
  const mockConfig = {
    llm: {
      endpoint: 'http://localhost:8080/v1/chat/completions',
      model: 'test-model',
      temperature: 0.2,
      maxTokens: 4096,
      timeout: 30000
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('parseResponse', () => {
    it('parses valid JSON response with approved status', async () => {
      const content = '{"status":"approved","feedback":"Looks good!"}';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toEqual({
        status: 'approved',
        feedback: 'Looks good!'
      });
    });

    it('parses valid JSON response with needs_revision status', async () => {
      const content = '{"status":"needs_revision","feedback":"Add more tests"}';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toEqual({
        status: 'needs_revision',
        feedback: 'Add more tests'
      });
    });

    it('parses valid JSON response with escalated status', async () => {
      const content = '{"status":"escalated","feedback":"Requires human review"}';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toEqual({
        status: 'escalated',
        feedback: 'Requires human review'
      });
    });

    it('handles response with extra content before JSON', async () => {
      const content = 'Here is my review:\n{"status":"approved","feedback":"Looks good!"}\nHope this helps!';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toEqual({
        status: 'approved',
        feedback: 'Looks good!'
      });
    });

    it('handles response with extra content after JSON', async () => {
      const content = '{"status":"approved","feedback":"Looks good!"}\n\nLet me know if you need anything else.';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toEqual({
        status: 'approved',
        feedback: 'Looks good!'
      });
    });

    it('returns null for invalid JSON', async () => {
      const content = 'This is not valid JSON at all!';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toBeNull();
    });

    it('returns null when missing status field', async () => {
      const content = '{"feedback":"Looks good!"}';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toBeNull();
    });

    it('returns null when missing feedback field', async () => {
      const content = '{"status":"approved"}';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toBeNull();
    });

    it('handles empty content with warning', async () => {
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse('');
      
      expect(result).toEqual({
        status: 'approved',
        feedback: ''
      });
    });

    it('handles whitespace-only content', async () => {
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse('   ');
      
      expect(result).toEqual({
        status: 'approved',
        feedback: ''
      });
    });

    it('handles JSON with extra fields', async () => {
      const content = '{"status":"approved","feedback":"Looks good!","extra_field":"ignored"}';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toEqual({
        status: 'approved',
        feedback: 'Looks good!'
      });
    });

    it('handles nested JSON objects (returns null since feedback should be string)', async () => {
      const content = '{"status":"needs_revision","feedback":{"main":"Bad","details":"More details"}}';
      const { parseResponse } = await import('../../src/llm-client.js');
      const result = parseResponse(content);
      
      expect(result).toBeNull();
    });
  });

  describe('createLLMClient', () => {
    it('submits review successfully', async () => {
      const mockResponse = {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"status":"approved","feedback":"Looks good!"}'
              },
              finish_reason: 'stop'
            }
          ]
        }
      };

      (axios.post as vi.Mock).mockResolvedValue(mockResponse);

      const { createLLMClient } = await import('../../src/llm-client.js');
      const client = createLLMClient(mockConfig);
      
      const result = await client.submitReview('Test prompt');
      
      expect(result).toEqual({
        status: 'approved',
        feedback: 'Looks good!'
      });

      expect(axios.post).toHaveBeenCalledWith(
        'http://localhost:8080/v1/chat/completions',
        {
          model: 'test-model',
          messages: [
            {
              role: 'system',
              content: expect.any(String)
            },
            {
              role: 'user',
              content: 'Test prompt'
            }
          ],
          temperature: 0.2,
          max_tokens: 4096
        },
        expect.objectContaining({
          timeout: 30000
        })
      );
    });

    it('handles timeout error gracefully', async () => {
      (axios.post as vi.Mock).mockRejectedValue({
        code: 'ECONNABORTED',
        message: 'timeout of 30000ms exceeded'
      });

      const { createLLMClient } = await import('../../src/llm-client.js');
      const client = createLLMClient(mockConfig);
      
      const result = await client.submitReview('Test prompt');
      
      expect(result).toBeNull();
    });

    it('handles network error gracefully', async () => {
      (axios.post as vi.Mock).mockRejectedValue({
        code: 'ECONNREFUSED',
        message: 'connect ECONNREFUSED 127.0.0.1:8080'
      });

      const { createLLMClient } = await import('../../src/llm-client.js');
      const client = createLLMClient(mockConfig);
      
      const result = await client.submitReview('Test prompt');
      
      expect(result).toBeNull();
    });

    it('handles invalid response from API', async () => {
      (axios.post as vi.Mock).mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'This is not valid JSON'
              },
              finish_reason: 'stop'
            }
          ]
        }
      });

      const { createLLMClient } = await import('../../src/llm-client.js');
      const client = createLLMClient(mockConfig);
      
      const result = await client.submitReview('Test prompt');
      
      expect(result).toBeNull();
    });

    it('handles empty choices array', async () => {
      (axios.post as vi.Mock).mockResolvedValue({
        data: {
          choices: []
        }
      });

      const { createLLMClient } = await import('../../src/llm-client.js');
      const client = createLLMClient(mockConfig);
      
      const result = await client.submitReview('Test prompt');
      
      expect(result).toBeNull();
    });

    it('handles missing message content', async () => {
      (axios.post as vi.Mock).mockResolvedValue({
        data: {
          choices: [
            {
              message: {},
              finish_reason: 'stop'
            }
          ]
        }
      });

      const { createLLMClient } = await import('../../src/llm-client.js');
      const client = createLLMClient(mockConfig);
      
      const result = await client.submitReview('Test prompt');
      
      expect(result).toBeNull();
    });

    it('uses custom timeout when provided', async () => {
      const mockResponse = {
        data: {
          choices: [
            {
              message: {
                role: 'assistant',
                content: '{"status":"approved","feedback":"Test"}'
              },
              finish_reason: 'stop'
            }
          ]
        }
      };

      (axios.post as vi.Mock).mockResolvedValue(mockResponse);

      const { createLLMClient } = await import('../../src/llm-client.js');
      const client = createLLMClient(mockConfig, { timeout: 15000 });
      
      await client.submitReview('Test prompt');
      
      expect(axios.post).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          timeout: 15000
        })
      );
    });
  });
});

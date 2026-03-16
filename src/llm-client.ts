import axios, { AxiosError } from 'axios';
import type { PingpongConfig, LLMRequest, LLMResponse } from './types.js';

interface LLMClientOptions {
  timeout?: number;
}

/**
 * Parse LLM response content to extract status and feedback
 * Expected format: JSON with "status" and "feedback" fields
 */
export function parseResponse(content: string): { status: string; feedback: string } | null {
  if (!content || !content.trim()) {
    console.warn('[LLM Client] Empty response content');
    return { status: 'approved', feedback: '' };
  }

  // Try to parse JSON from the content
  let jsonStart = content.indexOf('{');
  let jsonEnd = content.lastIndexOf('}');
  
  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) {
    console.warn('[LLM Client] No valid JSON found in response');
    return null;
  }

  const jsonString = content.slice(jsonStart, jsonEnd + 1);
  
  try {
    const parsed = JSON.parse(jsonString);
    
    if (typeof parsed.status !== 'string' || typeof parsed.feedback !== 'string') {
      console.warn('[LLM Client] Response missing required fields (status or feedback)');
      return null;
    }

    return {
      status: parsed.status,
      feedback: parsed.feedback
    };
  } catch (error) {
    console.warn('[LLM Client] Failed to parse JSON response:', error);
    return null;
  }
}

/**
 * Create LLM client for llama.cpp API
 */
export function createLLMClient(config: PingpongConfig, options: LLMClientOptions = {}): {
  submitReview: (prompt: string) => Promise<{ status: string; feedback: string } | null>;
} {
  const timeout = options.timeout ?? config.llm.timeout ?? 30000;
  const endpoint = config.llm.endpoint;
  const model = config.llm.model;

  async function submitReview(prompt: string): Promise<{ status: string; feedback: string } | null> {
    const request: LLMRequest = {
      model: model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert code reviewer. Analyze the code changes and provide feedback. Respond ONLY with a JSON object containing "status" (approved|needs_revision|escalated) and "feedback" (your detailed analysis). Do not include any other text, markdown formatting, or explanations.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: config.llm.temperature ?? 0.2,
      max_tokens: config.llm.maxTokens ?? 4096
    };

    try {
      const response = await axios.post<LLMResponse>(endpoint, request, {
        timeout: timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const firstChoice = response.data.choices?.[0];
      if (!firstChoice?.message?.content) {
        console.warn('[LLM Client] No content in LLM response');
        return null;
      }

      return parseResponse(firstChoice.message.content);
    } catch (error) {
      if (axios.isCancel(error)) {
        console.error('[LLM Client] Request timeout');
        return null;
      }
      
      const axiosError = error as AxiosError;
      if (axiosError.code === 'ECONNABORTED' || axiosError.message?.includes('timeout')) {
        console.error('[LLM Client] Request timeout');
        return null;
      }

      if (axiosError.response) {
        console.error('[LLM Client] LLM API error:', {
          status: axiosError.response.status,
          data: axiosError.response.data
        });
      } else if (axiosError.request) {
        console.error('[LLM Client] No response from LLM API');
      } else {
        console.error('[LLM Client] Request error:', axiosError.message);
      }
      
      return null;
    }
  }

  return { submitReview };
}

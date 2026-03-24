import { modelRouter } from '../router.js';

interface SelectModelInput {
  prompt: string;
  context?: string;
}

interface SelectModelOutput {
  model: string;
  cached: boolean;
  latencyMs: number;
}

export async function mcp_pingpong_select_model(
  input: SelectModelInput
): Promise<SelectModelOutput> {
  const fullPrompt = input.context ? `${input.context}

${input.prompt}` : input.prompt;
  return await modelRouter.selectModel(fullPrompt);
}

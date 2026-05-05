import type { RequestLogger } from '../../utils/logger.js';
import type { AnthropicMessage, ClaudeTool, MessageParam } from './types.js';
import { ClaudeAPIError } from '../../utils/errors.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

export interface CallClaudeParams {
  messages: MessageParam[];
  tools: ClaudeTool[];
  systemPrompt: string;
  model: string;
  maxTokens: number;
  apiKey: string;
  logger: RequestLogger;
  signal?: AbortSignal;
}

export async function callClaude(params: CallClaudeParams): Promise<AnthropicMessage> {
  const { messages, tools, systemPrompt, model, maxTokens, apiKey, logger, signal } = params;
  const startMs = Date.now();

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
    tools: tools.length > 0 ? tools : undefined,
  });

  const response = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': API_VERSION,
    },
    body,
    signal: signal ?? null,
  });

  const latencyMs = Date.now() - startMs;

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    logger.error('claude_api_error', {
      status: response.status,
      latency_ms: latencyMs,
      body: errorBody.slice(0, 500),
    });
    throw new ClaudeAPIError(`Claude API returned ${response.status}`, response.status, errorBody);
  }

  const result = (await response.json()) as AnthropicMessage;
  logger.log('claude_api_call', {
    model: result.model,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
    latency_ms: latencyMs,
  });

  return result;
}

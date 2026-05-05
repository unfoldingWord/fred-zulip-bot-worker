import type {
  OrchestrationOptions,
  OrchestrationResult,
  MessageParam,
  ContentBlock,
  ToolUseBlock,
  AnthropicMessage,
} from './types.js';
import { callClaude } from './anthropic-client.js';
import { executeToolCalls } from './tool-execution.js';
import { TimeoutError } from '../../utils/errors.js';

export async function orchestrate(
  options: OrchestrationOptions,
  apiKey: string
): Promise<OrchestrationResult> {
  const { context } = options;
  const { config, logger } = context;
  const messages = buildInitialMessages(options);

  logger.log('orchestration_start', { model: config.model, history_length: messages.length });

  let iterations = 0;
  let totalInput = 0;
  let totalOutput = 0;

  while (iterations < config.maxIterations) {
    iterations++;
    const result = await callClaudeWithTimeout(messages, options, apiKey);

    totalInput += result.usage.input_tokens;
    totalOutput += result.usage.output_tokens;

    logger.log('orchestration_iteration', {
      iteration: iterations,
      stop_reason: result.stop_reason,
      tools_called: extractToolNames(result.content),
    });

    if (result.stop_reason !== 'tool_use') {
      return buildResult(result, iterations, totalInput, totalOutput);
    }

    const toolResults = await handleToolCalls(result, context, messages);
    if (!toolResults) break;
  }

  logger.warn('orchestration_max_iterations', { iterations });
  return {
    response: 'I reached my processing limit. Here is what I have so far.',
    iterations,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
  };
}

function buildInitialMessages(options: OrchestrationOptions): MessageParam[] {
  const { conversationHistory, userMessage } = options;
  const history: MessageParam[] = conversationHistory.map((m) => {
    if (m.role === 'assistant') {
      return { role: 'assistant' as const, content: [{ type: 'text' as const, text: m.content }] };
    }
    return { role: 'user' as const, content: m.content };
  });
  return [...history, { role: 'user', content: userMessage }];
}

async function callClaudeWithTimeout(
  messages: MessageParam[],
  options: OrchestrationOptions,
  apiKey: string
): Promise<AnthropicMessage> {
  const { context, tools, systemPrompt } = options;
  if (context.abortSignal.aborted) {
    throw new TimeoutError('Orchestration timed out', 90000);
  }
  return callClaude({
    messages,
    tools,
    systemPrompt,
    model: context.config.model,
    maxTokens: context.config.maxTokens,
    apiKey,
    logger: context.logger,
    signal: context.abortSignal,
  });
}

async function handleToolCalls(
  result: AnthropicMessage,
  context: OrchestrationOptions['context'],
  messages: MessageParam[]
): Promise<boolean> {
  const toolCalls = result.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
  if (toolCalls.length === 0) return false;

  messages.push({ role: 'assistant', content: result.content });
  const toolResults = await executeToolCalls(toolCalls, context);
  messages.push({ role: 'user', content: toolResults as unknown as ContentBlock[] });
  return true;
}

function extractToolNames(content: ContentBlock[]): string[] {
  return content.filter((b): b is ToolUseBlock => b.type === 'tool_use').map((b) => b.name);
}

function buildResult(
  result: AnthropicMessage,
  iterations: number,
  totalInput: number,
  totalOutput: number
): OrchestrationResult {
  const textBlocks = result.content.filter((b) => b.type === 'text');
  const response = textBlocks.map((b) => ('text' in b ? b.text : '')).join('\n');
  return { response, iterations, totalInputTokens: totalInput, totalOutputTokens: totalOutput };
}

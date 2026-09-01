import type {
  OrchestrationOptions,
  OrchestrationResult,
  MessageParam,
  ContentBlock,
  TextBlock,
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
  // Text is banked per iteration instead of being read off the final message. A turn cut off
  // by the output ceiling carries no text blocks at all, so reading only the last turn threw
  // away everything the model had already written and produced a blank reply. Ported from
  // bt-servant-worker's `ctx.responses` accumulation.
  const collected: string[] = [];

  while (iterations < config.maxIterations) {
    iterations++;
    context.iterations = iterations;
    const result = await callClaudeWithTimeout(messages, options, apiKey);

    totalInput += result.usage.input_tokens;
    totalOutput += result.usage.output_tokens;

    const turnText = extractTextBlocks(result.content);
    collected.push(...turnText);
    const toolCalls = result.content.filter(isToolUseBlock);

    logger.log('orchestration_iteration', {
      iteration: iterations,
      stop_reason: result.stop_reason,
      tools_called: toolCalls.map((b) => b.name),
      text_blocks: turnText.length,
      text_blocks_total: collected.length,
    });

    // Exit only on a natural finish, or when there is nothing left to execute. A `max_tokens`
    // stop that still holds tool calls falls through and keeps going, so the model can recover
    // from being cut off mid-call; `maxIterations` and the watchdog remain the real bounds.
    // Unlisted stop reasons with no tool calls exit here too, returning the accumulated text
    // rather than an empty string.
    if (result.stop_reason === 'end_turn' || toolCalls.length === 0) {
      return buildResult(result, collected, iterations, totalInput, totalOutput);
    }

    if (result.stop_reason === 'max_tokens') {
      logger.warn('orchestration_max_tokens_continue', {
        iteration: iterations,
        output_tokens: result.usage.output_tokens,
        tool_calls: toolCalls.length,
      });
    }

    await handleToolCalls(result, toolCalls, context, messages);
  }

  logger.warn('orchestration_max_iterations', { iterations });
  return {
    response: collected.join('\n') || 'I reached my processing limit. Here is what I have so far.',
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

/**
 * Append the assistant turn and the results of its tool calls to the running message list.
 * A turn truncated mid-call can carry incomplete `input`; `executeToolCalls` turns that into
 * a `tool_result` with `is_error: true` rather than throwing, which is what lets the next
 * iteration recover.
 */
async function handleToolCalls(
  result: AnthropicMessage,
  toolCalls: ToolUseBlock[],
  context: OrchestrationOptions['context'],
  messages: MessageParam[]
): Promise<void> {
  messages.push({ role: 'assistant', content: result.content });
  const toolResults = await executeToolCalls(toolCalls, context);
  messages.push({ role: 'user', content: toolResults as unknown as ContentBlock[] });
}

function isToolUseBlock(block: ContentBlock): block is ToolUseBlock {
  return block.type === 'tool_use';
}

/** Non-empty text from one turn; whitespace-only blocks are dropped so they can't pad the join. */
function extractTextBlocks(content: ContentBlock[]): string[] {
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .filter((text) => text.trim().length > 0);
}

function buildResult(
  result: AnthropicMessage,
  collected: string[],
  iterations: number,
  totalInput: number,
  totalOutput: number
): OrchestrationResult {
  return {
    response: collected.join('\n'),
    iterations,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    stopReason: result.stop_reason,
    truncated: result.stop_reason === 'max_tokens',
  };
}

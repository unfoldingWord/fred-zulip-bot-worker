import type { Env } from '../types/env.js';
import type { ZulipWebhookPayload } from './zulip/types.js';
import type { RequestLogger } from '../utils/logger.js';
import { ZulipClient } from './zulip/client.js';
import { createPipelineContext } from './pipeline/setup.js';
import { prepareOrchestrationInputs } from './pipeline/prepare-context.js';
import { sendResponse, sendErrorMessage } from './pipeline/send-response.js';
import { orchestrate } from './claude/orchestrator.js';
import { buildSystemPrompt } from './claude/system-prompt.js';
import { buildToolDefinitions } from './claude/tools.js';
import { generateToolCatalogMarkdown } from './mcp/catalog.js';

const ORCHESTRATION_TIMEOUT_MS = 90000;

export async function handleMessage(payload: ZulipWebhookPayload, env: Env): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORCHESTRATION_TIMEOUT_MS);
  const ctx = createPipelineContext(payload, env, controller.signal);
  const { logger, client } = ctx;

  try {
    const inputs = await prepareOrchestrationInputs(ctx, payload.message, env);
    const systemPrompt = buildSystemPrompt({
      toolCatalogMarkdown: generateToolCatalogMarkdown(inputs.catalog),
      queryRules: inputs.queryRules,
      conversationHistory: inputs.conversationHistory,
    });
    const tools = buildToolDefinitions(inputs.catalog);

    const result = await orchestrate(
      {
        userMessage: ctx.userMessage,
        conversationHistory: inputs.conversationHistory,
        systemPrompt,
        tools,
        context: ctx.orchestrationCtx,
      },
      env.ANTHROPIC_API_KEY
    );

    await sendResponse(client, payload, result.response, logger);
    logger.log('request_complete', {
      total_duration_ms: Date.now(),
      iterations: result.iterations,
      total_input_tokens: result.totalInputTokens,
      total_output_tokens: result.totalOutputTokens,
    });
  } catch (e) {
    logger.error('message_processing_error', { error: String(e) });
    await sendErrorMessage(client, payload, logger);
  } finally {
    clearTimeout(timeout);
    await removeThinkingReaction(client, payload.message.id, logger);
  }
}

async function removeThinkingReaction(
  client: ZulipClient,
  messageId: number,
  logger: RequestLogger
): Promise<void> {
  const res = await client.removeReaction(messageId, 'thinking');
  if (!res.ok) {
    logger.warn('reaction_remove_failed', { message_id: messageId, status: res.status });
  }
}

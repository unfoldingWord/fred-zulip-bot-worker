import type { Env } from '../types/env.js';
import type { ZulipWebhookPayload } from './zulip/types.js';
import type { RequestLogger } from '../utils/logger.js';
import type { PipelineContext } from './pipeline/setup.js';
import { ZulipClient } from './zulip/client.js';
import { createPipelineContext } from './pipeline/setup.js';
import { prepareOrchestrationInputs } from './pipeline/prepare-context.js';
import { sendResponse, sendErrorMessage } from './pipeline/send-response.js';
import { orchestrate } from './claude/orchestrator.js';
import { buildSystemPrompt } from './claude/system-prompt.js';
import { buildToolDefinitions } from './claude/tools.js';
import { generateToolCatalogMarkdown } from './mcp/catalog.js';
import { createRequestLogger } from '../utils/logger.js';

// Wall-clock backstop for orchestration inside the FredDO. Set well below
// the configured 300s CPU cap so the AbortController fires first and the
// catch path has slack (~30s) to post a Zulip error reply before the
// runtime kills the invocation. #13 will replace this with a proper
// watchdog (env-configurable, dedicated timeout-reply text, log signal).
const ORCHESTRATION_TIMEOUT_MS = 270000;

export async function processFredMessage(
  payload: ZulipWebhookPayload,
  env: Env,
  requestId: string = crypto.randomUUID()
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ORCHESTRATION_TIMEOUT_MS);
  // Bootstrap logger covers the small window before pipeline-context setup
  // succeeds; createPipelineContext makes its own logger that we use once
  // available.
  let logger: RequestLogger = createRequestLogger(requestId);
  let client: ZulipClient | null = null;

  try {
    const ctx = createPipelineContext(payload, env, controller.signal, requestId);
    logger = ctx.logger;
    client = ctx.client;
    await runPipeline(ctx, payload, env);
  } catch (e) {
    await handleProcessingFailure(e, env, payload, logger, client);
  } finally {
    clearTimeout(timeout);
    if (client) {
      await removeThinkingReaction(client, payload.message.id, logger);
    }
  }
}

async function runPipeline(
  ctx: PipelineContext,
  payload: ZulipWebhookPayload,
  env: Env
): Promise<void> {
  const { logger, client } = ctx;
  const startMs = Date.now();
  await addThinkingReaction(client, payload.message.id, logger);

  const inputs = await prepareOrchestrationInputs(ctx, payload.message, env);
  const systemPrompt = buildSystemPrompt({
    toolCatalogMarkdown: generateToolCatalogMarkdown(inputs.catalog),
    queryRules: inputs.queryRules,
    schema: inputs.schema,
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

  if (!result.response || result.response.trim().length === 0) {
    logger.warn('orchestration_empty_response', {
      iterations: result.iterations,
      total_input_tokens: result.totalInputTokens,
      total_output_tokens: result.totalOutputTokens,
    });
    await sendErrorMessage(client, payload, env.ZULIP_BOT_EMAIL, logger, 'no response generated');
    return;
  }

  await sendResponse(client, payload, env.ZULIP_BOT_EMAIL, result.response, logger);
  logger.log('request_complete', {
    total_duration_ms: Date.now() - startMs,
    iterations: result.iterations,
    total_input_tokens: result.totalInputTokens,
    total_output_tokens: result.totalOutputTokens,
  });
}

async function handleProcessingFailure(
  error: unknown,
  env: Env,
  payload: ZulipWebhookPayload,
  logger: RequestLogger,
  client: ZulipClient | null
): Promise<void> {
  logger.error('message_processing_error', {
    error: error instanceof Error ? error.message : String(error),
    error_name: error instanceof Error ? error.name : 'Unknown',
    stage: client ? 'pipeline' : 'setup',
  });
  const errorClient = client ?? buildFallbackClient(env);
  // sendErrorMessage swallows its own throws and reports via
  // error_message_send_failed_fatal, but we still wrap defensively so a
  // failure in client construction or anywhere else here cannot bubble out
  // of handleMessage as an unhandled rejection in waitUntil.
  try {
    await sendErrorMessage(errorClient, payload, env.ZULIP_BOT_EMAIL, logger);
  } catch (sendErr) {
    logger.error('error_handler_unexpected_throw', {
      error: sendErr instanceof Error ? sendErr.message : String(sendErr),
    });
  }
}

function buildFallbackClient(env: Env): ZulipClient {
  return new ZulipClient(env.ZULIP_SITE, env.ZULIP_BOT_EMAIL, env.ZULIP_BOT_API_KEY);
}

async function addThinkingReaction(
  client: ZulipClient,
  messageId: number,
  logger: RequestLogger
): Promise<void> {
  try {
    const res = await client.addReaction(messageId, 'thinking');
    if (!res.ok) {
      logger.warn('reaction_add_failed', { message_id: messageId, status: res.status });
    }
  } catch (e) {
    logger.warn('reaction_add_threw', {
      message_id: messageId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function removeThinkingReaction(
  client: ZulipClient,
  messageId: number,
  logger: RequestLogger
): Promise<void> {
  try {
    const res = await client.removeReaction(messageId, 'thinking');
    if (!res.ok) {
      logger.warn('reaction_remove_failed', { message_id: messageId, status: res.status });
    }
  } catch (e) {
    logger.warn('reaction_remove_threw', {
      message_id: messageId,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

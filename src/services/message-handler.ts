import type { Env } from '../types/env.js';
import type { ZulipWebhookPayload } from './zulip/types.js';
import type { RequestLogger } from '../utils/logger.js';
import type { PipelineContext } from './pipeline/setup.js';
import type { OrchestrationContext } from './claude/types.js';
import { ZulipClient } from './zulip/client.js';
import { createPipelineContext } from './pipeline/setup.js';
import { prepareOrchestrationInputs } from './pipeline/prepare-context.js';
import { sendResponse, sendErrorMessage } from './pipeline/send-response.js';
import { orchestrate } from './claude/orchestrator.js';
import { buildSystemPrompt } from './claude/system-prompt.js';
import { buildToolDefinitions } from './claude/tools.js';
import { generateToolCatalogMarkdown } from './mcp/catalog.js';
import { createRequestLogger } from '../utils/logger.js';
import { parseIntEnvVar } from '../utils/config.js';

const DEFAULT_TIMEOUT_MS = 270000;

interface FailureContext {
  env: Env;
  payload: ZulipWebhookPayload;
  logger: RequestLogger;
  client: ZulipClient | null;
  requestId: string;
  startMs: number;
  orchestrationCtx?: OrchestrationContext | undefined;
}

export async function processFredMessage(
  payload: ZulipWebhookPayload,
  env: Env,
  requestId: string = crypto.randomUUID()
): Promise<void> {
  const startMs = Date.now();
  const controller = new AbortController();
  // Bootstrap logger covers the small window before pipeline-context setup
  // succeeds; createPipelineContext makes its own logger that we use once
  // available.
  let logger: RequestLogger = createRequestLogger(requestId);
  const timeoutMs = parseIntEnvVar(
    env.ORCHESTRATION_TIMEOUT_MS,
    'ORCHESTRATION_TIMEOUT_MS',
    DEFAULT_TIMEOUT_MS,
    logger
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let client: ZulipClient | null = null;
  let ctx: PipelineContext | undefined;

  try {
    ctx = createPipelineContext(payload, env, controller.signal, requestId);
    logger = ctx.logger;
    client = ctx.client;
    await runPipeline(ctx, payload, env);
  } catch (e) {
    const fCtx: FailureContext = {
      env,
      payload,
      logger,
      client,
      requestId,
      startMs,
      orchestrationCtx: ctx?.orchestrationCtx,
    };
    if (controller.signal.aborted) {
      await handleWatchdogTimeout(e, fCtx);
    } else {
      await handleUncaughtThrow(e, fCtx);
    }
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
    await sendErrorMessage(client, payload, env.ZULIP_BOT_EMAIL, logger, {
      detail: 'no response generated',
    });
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

function errorFields(error: unknown) {
  return {
    error: error instanceof Error ? error.message : String(error),
    error_name: error instanceof Error ? error.name : 'Unknown',
  };
}

async function handleWatchdogTimeout(error: unknown, ctx: FailureContext): Promise<void> {
  const { env, payload, logger, requestId, startMs, orchestrationCtx } = ctx;
  logger.error('watchdog_fired', {
    iterations: orchestrationCtx?.iterations ?? 0,
    elapsed_ms: Date.now() - startMs,
    ...errorFields(error),
  });
  const text =
    'This question hit my processing budget. Try a narrower version, ' +
    `or ask me to break it into pieces. Request ID: \`${requestId}\`.`;
  await trySendError(ctx.client ?? buildFallbackClient(env), payload, env, logger, { text });
}

async function handleUncaughtThrow(error: unknown, ctx: FailureContext): Promise<void> {
  const { env, payload, logger, client, requestId, orchestrationCtx } = ctx;
  logger.error('orchestration_uncaught_throw', {
    iterations: orchestrationCtx?.iterations ?? 0,
    stage: client ? 'pipeline' : 'setup',
    ...errorFields(error),
  });
  const errorClient = client ?? buildFallbackClient(env);
  await trySendError(errorClient, payload, env, logger, {
    detail: `Request ID: ${requestId}`,
  });
}

async function trySendError(
  client: ZulipClient,
  payload: ZulipWebhookPayload,
  env: Env,
  logger: RequestLogger,
  options: { detail?: string; text?: string }
): Promise<void> {
  try {
    await sendErrorMessage(client, payload, env.ZULIP_BOT_EMAIL, logger, options);
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

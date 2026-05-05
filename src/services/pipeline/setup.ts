import type { Env } from '../../types/env.js';
import type { ZulipWebhookPayload } from '../zulip/types.js';
import type { RequestLogger } from '../../utils/logger.js';
import type { OrchestrationContext } from '../claude/types.js';
import { ZulipClient } from '../zulip/client.js';
import { createRequestLogger } from '../../utils/logger.js';
import { getOrchestrationConfig } from '../../utils/config.js';
import { buildFredMCPConfig } from '../mcp/server-config.js';
import { HealthTracker } from '../mcp/health.js';
import { deriveThreadKey } from '../zulip/thread-key.js';

export interface PipelineContext {
  requestId: string;
  logger: RequestLogger;
  client: ZulipClient;
  orchestrationCtx: OrchestrationContext;
  threadKey: string;
  userMessage: string;
}

export function createPipelineContext(
  payload: ZulipWebhookPayload,
  env: Env,
  abortSignal: AbortSignal
): PipelineContext {
  const requestId = crypto.randomUUID();
  const logger = createRequestLogger(requestId);
  const client = new ZulipClient(env.ZULIP_SITE, env.ZULIP_BOT_EMAIL, env.ZULIP_BOT_API_KEY);
  const config = getOrchestrationConfig(env, logger);
  const mcpConfig = buildFredMCPConfig(env);

  const orchestrationCtx: OrchestrationContext = {
    config,
    mcpConfig,
    catalog: { tools: [] },
    healthTracker: new HealthTracker(),
    logger,
    requestId,
    mcpCallCount: 0,
    abortSignal,
  };

  return {
    requestId,
    logger,
    client,
    orchestrationCtx,
    threadKey: deriveThreadKey(payload.message),
    userMessage: payload.message.content,
  };
}

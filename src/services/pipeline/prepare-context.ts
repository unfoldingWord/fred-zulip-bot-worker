import type { PipelineContext } from './setup.js';
import type { Env } from '../../types/env.js';
import type { ZulipMessage } from '../zulip/types.js';
import type { ClaudeMessage } from '../history/types.js';
import type { ToolCatalog } from '../mcp/types.js';
import { getConversationContext } from '../history/index.js';
import { discoverTools } from '../mcp/discovery.js';
import { buildToolCatalog } from '../mcp/catalog.js';
import { fetchPromptText } from '../mcp/prompts.js';
import { fetchSchemaForPrompt } from '../schema/preload.js';

const QUERY_RULES_PROMPT_NAME = 'fred_query_rules';

export interface OrchestrationInputs {
  conversationHistory: ClaudeMessage[];
  catalog: ToolCatalog;
  queryRules: string;
  schema: string;
}

export async function prepareOrchestrationInputs(
  ctx: PipelineContext,
  message: ZulipMessage,
  env: Env
): Promise<OrchestrationInputs> {
  const { client, orchestrationCtx, logger } = ctx;

  const [history, manifest, queryRules, schema] = await Promise.all([
    getConversationContext(client, message, env.ZULIP_BOT_EMAIL, logger),
    discoverTools(orchestrationCtx.mcpConfig, logger),
    fetchPromptText(orchestrationCtx.mcpConfig, QUERY_RULES_PROMPT_NAME, logger),
    fetchSchemaForPrompt(env.CONVERSATION_CACHE, orchestrationCtx.mcpConfig, logger),
  ]);

  const catalog = buildToolCatalog(manifest);
  orchestrationCtx.catalog = catalog;

  return { conversationHistory: history, catalog, queryRules, schema };
}

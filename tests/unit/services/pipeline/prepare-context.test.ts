import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prepareOrchestrationInputs } from '../../../../src/services/pipeline/prepare-context.js';
import type { PipelineContext } from '../../../../src/services/pipeline/setup.js';
import type { Env } from '../../../../src/types/env.js';
import type { ZulipMessage } from '../../../../src/services/zulip/types.js';
import type { OrchestrationContext } from '../../../../src/services/claude/types.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';
import type { ZulipClient } from '../../../../src/services/zulip/client.js';

vi.mock('../../../../src/services/history/index.js', () => ({
  getConversationContext: vi.fn(),
}));
vi.mock('../../../../src/services/mcp/discovery.js', () => ({
  discoverTools: vi.fn(),
}));
vi.mock('../../../../src/services/mcp/prompts.js', () => ({
  fetchPromptText: vi.fn(),
}));
vi.mock('../../../../src/services/schema/preload.js', () => ({
  fetchSchemaForPrompt: vi.fn(),
}));

import { getConversationContext } from '../../../../src/services/history/index.js';
import { discoverTools } from '../../../../src/services/mcp/discovery.js';
import { fetchPromptText } from '../../../../src/services/mcp/prompts.js';
import { fetchSchemaForPrompt } from '../../../../src/services/schema/preload.js';

function makeLogger(): RequestLogger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeCtx(): PipelineContext {
  const logger = makeLogger();
  const orchestrationCtx: OrchestrationContext = {
    config: {} as OrchestrationContext['config'],
    mcpConfig: { id: 'fred-mcp', name: 'Fred MCP', url: 'https://mcp.test', authToken: 'tok' },
    catalog: { tools: [] },
    healthTracker: { isUnhealthy: () => false } as unknown as OrchestrationContext['healthTracker'],
    logger,
    requestId: 'req-1',
    mcpCallCount: 0,
    iterations: 0,
    abortSignal: new AbortController().signal,
  };
  return {
    requestId: 'req-1',
    logger,
    client: {} as ZulipClient,
    orchestrationCtx,
    threadKey: 'channel:1:topic',
    userMessage: 'hi',
  };
}

const env = {
  ZULIP_BOT_EMAIL: 'fred@example.com',
  CONVERSATION_CACHE: { get: vi.fn(), put: vi.fn() } as unknown as KVNamespace,
} as Env;

const message = { id: 1, content: 'hi' } as unknown as ZulipMessage;

describe('prepareOrchestrationInputs', () => {
  beforeEach(() => {
    vi.mocked(getConversationContext).mockReset();
    vi.mocked(discoverTools).mockReset();
    vi.mocked(fetchPromptText).mockReset();
    vi.mocked(fetchSchemaForPrompt).mockReset();
  });

  it('fans out history, discovery, prompts, and schema in parallel and returns all four', async () => {
    vi.mocked(getConversationContext).mockResolvedValue([{ role: 'user', content: 'past' }]);
    vi.mocked(discoverTools).mockResolvedValue({
      serverId: 'fred-mcp',
      tools: [{ name: 'execute_sql', description: 'sql', inputSchema: {} }],
    });
    vi.mocked(fetchPromptText).mockResolvedValue('rule: use snake_case');
    vi.mocked(fetchSchemaForPrompt).mockResolvedValue(
      't:countries:cols=alpha_3_code:varchar(3)!:PK'
    );

    const ctx = makeCtx();
    const inputs = await prepareOrchestrationInputs(ctx, message, env);

    expect(inputs.conversationHistory).toEqual([{ role: 'user', content: 'past' }]);
    expect(inputs.catalog.tools).toHaveLength(1);
    expect(inputs.catalog.tools[0].name).toBe('execute_sql');
    expect(inputs.queryRules).toBe('rule: use snake_case');
    expect(inputs.schema).toBe('t:countries:cols=alpha_3_code:varchar(3)!:PK');

    expect(fetchSchemaForPrompt).toHaveBeenCalledWith(
      env.CONVERSATION_CACHE,
      ctx.orchestrationCtx.mcpConfig,
      ctx.logger
    );
    expect(ctx.orchestrationCtx.catalog.tools).toHaveLength(1);
  });

  it('still returns inputs when the schema branch returns empty (degraded path)', async () => {
    vi.mocked(getConversationContext).mockResolvedValue([]);
    vi.mocked(discoverTools).mockResolvedValue({ serverId: 'fred-mcp', tools: [] });
    vi.mocked(fetchPromptText).mockResolvedValue('');
    vi.mocked(fetchSchemaForPrompt).mockResolvedValue('');

    const inputs = await prepareOrchestrationInputs(makeCtx(), message, env);

    expect(inputs.schema).toBe('');
    expect(inputs.queryRules).toBe('');
  });
});

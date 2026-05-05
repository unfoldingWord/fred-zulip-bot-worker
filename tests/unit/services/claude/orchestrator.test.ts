import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orchestrate } from '../../../../src/services/claude/orchestrator.js';
import type {
  OrchestrationOptions,
  OrchestrationContext,
} from '../../../../src/services/claude/types.js';
import { HealthTracker } from '../../../../src/services/mcp/health.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

describe('orchestrate', () => {
  let originalFetch: typeof globalThis.fetch;
  const logger: RequestLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeContext(overrides?: Partial<OrchestrationContext>): OrchestrationContext {
    return {
      config: {
        model: 'claude-sonnet-4-6',
        maxTokens: 4096,
        maxIterations: 5,
        codeExecTimeoutMs: 30000,
        maxMcpCallsPerExecution: 10,
        maxMcpCallsPerRequest: 50,
        fredMcpUrl: 'https://mcp.test',
      },
      mcpConfig: { id: 'fred-mcp', name: 'Fred', url: 'https://mcp.test', authToken: 'tok' },
      catalog: { tools: [] },
      healthTracker: new HealthTracker(),
      logger,
      requestId: 'test-req',
      mcpCallCount: 0,
      abortSignal: new AbortController().signal,
      ...overrides,
    };
  }

  function makeOptions(ctx: OrchestrationContext): OrchestrationOptions {
    return {
      userMessage: 'Hello',
      conversationHistory: [],
      systemPrompt: 'You are Fred.',
      tools: [],
      context: ctx,
    };
  }

  function mockClaudeEndTurn(text: string) {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          content: [{ type: 'text', text }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        })
      )
    );
  }

  it('returns text response on end_turn', async () => {
    const ctx = makeContext();
    mockClaudeEndTurn('Hello! I am Fred.');

    const result = await orchestrate(makeOptions(ctx), 'api-key');

    expect(result.response).toBe('Hello! I am Fred.');
    expect(result.iterations).toBe(1);
    expect(result.totalInputTokens).toBe(100);
    expect(result.totalOutputTokens).toBe(50);
  });

  it('respects max iterations limit', async () => {
    const ctx = makeContext({ config: { ...makeContext().config, maxIterations: 2 } });

    // Always request tool use but with unknown tools — return new Response each time
    globalThis.fetch = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            id: 'msg_1',
            type: 'message',
            role: 'assistant',
            model: 'claude-sonnet-4-6',
            content: [
              { type: 'text', text: 'Let me check...' },
              { type: 'tool_use', id: 'tu_1', name: 'unknown_tool', input: {} },
            ],
            stop_reason: 'tool_use',
            usage: { input_tokens: 50, output_tokens: 25 },
          })
        )
      )
    );

    const result = await orchestrate(makeOptions(ctx), 'api-key');

    expect(result.iterations).toBe(2);
    expect(logger.warn).toHaveBeenCalledWith('orchestration_max_iterations', expect.any(Object));
  });

  it('logs orchestration_start event', async () => {
    const ctx = makeContext();
    mockClaudeEndTurn('Hi');

    await orchestrate(makeOptions(ctx), 'api-key');

    expect(logger.log).toHaveBeenCalledWith(
      'orchestration_start',
      expect.objectContaining({
        model: 'claude-sonnet-4-6',
      })
    );
  });
});

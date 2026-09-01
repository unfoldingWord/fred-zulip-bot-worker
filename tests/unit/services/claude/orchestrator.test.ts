import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { orchestrate } from '../../../../src/services/claude/orchestrator.js';
import type {
  OrchestrationOptions,
  OrchestrationContext,
} from '../../../../src/services/claude/types.js';
import { HealthTracker } from '../../../../src/services/mcp/health.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

// Helpers live at module scope so each `describe` block stays inside the
// max-lines-per-function cap the pre-commit lint enforces on tests.
const logger: RequestLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

let originalFetch: typeof globalThis.fetch;

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
      maxTokens: 64000,
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
    iterations: 0,
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

/** One Claude turn. `toolName` adds a tool_use block; omitting `text` yields no text blocks. */
function turn(args: {
  text?: string;
  toolName?: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  outputTokens?: number;
}) {
  const content: unknown[] = [];
  if (args.text !== undefined) content.push({ type: 'text', text: args.text });
  if (args.toolName) {
    content.push({ type: 'tool_use', id: 'tu_1', name: args.toolName, input: {} });
  }
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content,
      stop_reason: args.stopReason,
      usage: { input_tokens: 10, output_tokens: args.outputTokens ?? 20 },
    })
  );
}

/** Queue one response per orchestration iteration, in order. */
function mockTurns(...responses: Response[]) {
  const fetchMock = vi.fn();
  for (const res of responses) fetchMock.mockResolvedValueOnce(res);
  globalThis.fetch = fetchMock;
  return fetchMock;
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

describe('orchestrate', () => {
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

describe('orchestrate — output ceiling and truncation', () => {
  // Regression: production requests ca4b3572 / 5a146566 were cut off mid-execute_code at
  // exactly 4096 output tokens. The turn stopped on max_tokens holding a tool_use block and
  // no text, the loop exited, and the user got "no response generated".
  it('continues past a max_tokens turn that still holds tool calls', async () => {
    const ctx = makeContext();
    const fetchMock = mockTurns(
      turn({ toolName: 'unknown_tool', stopReason: 'max_tokens', outputTokens: 4096 }),
      turn({ text: 'Here is the report.', stopReason: 'end_turn' })
    );

    const result = await orchestrate(makeOptions(ctx), 'api-key');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.iterations).toBe(2);
    expect(result.response).toBe('Here is the report.');
    expect(result.truncated).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'orchestration_max_tokens_continue',
      expect.objectContaining({ iteration: 1, output_tokens: 4096, tool_calls: 1 })
    );
  });

  it('accumulates text across iterations rather than keeping only the final turn', async () => {
    const ctx = makeContext();
    mockTurns(
      turn({ text: 'First, the totals.', toolName: 'unknown_tool', stopReason: 'tool_use' }),
      turn({ text: 'Now the breakdown.', stopReason: 'end_turn' })
    );

    const result = await orchestrate(makeOptions(ctx), 'api-key');

    expect(result.response).toBe('First, the totals.\nNow the breakdown.');
  });

  it('flags truncation instead of returning an empty response', async () => {
    const ctx = makeContext();
    // Cut off with no text and no tool call to continue from — nothing was ever said.
    mockTurns(turn({ stopReason: 'max_tokens', outputTokens: 4096 }));

    const result = await orchestrate(makeOptions(ctx), 'api-key');

    expect(result.response).toBe('');
    expect(result.truncated).toBe(true);
    expect(result.stopReason).toBe('max_tokens');
  });

  it('still exits on the first turn for a plain end_turn', async () => {
    const ctx = makeContext();
    const fetchMock = mockTurns(turn({ text: 'Done.', stopReason: 'end_turn' }));

    const result = await orchestrate(makeOptions(ctx), 'api-key');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.response).toBe('Done.');
    expect(result.truncated).toBe(false);
    expect(result.stopReason).toBe('end_turn');
  });
});

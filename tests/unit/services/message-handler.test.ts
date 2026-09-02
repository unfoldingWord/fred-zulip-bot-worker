import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ZulipWebhookPayload } from '../../../src/services/zulip/types.js';
import type { RequestLogger } from '../../../src/utils/logger.js';
import type { PipelineContext } from '../../../src/services/pipeline/setup.js';
import type { OrchestrationContext } from '../../../src/services/claude/types.js';
import { HealthTracker } from '../../../src/services/mcp/health.js';
import { ZulipClient } from '../../../src/services/zulip/client.js';

vi.mock('../../../src/services/pipeline/setup.js', () => ({
  createPipelineContext: vi.fn(),
}));
vi.mock('../../../src/services/claude/orchestrator.js', () => ({
  orchestrate: vi.fn(),
}));
vi.mock('../../../src/services/pipeline/send-response.js', () => ({
  sendResponse: vi.fn().mockResolvedValue(undefined),
  sendErrorMessage: vi.fn().mockResolvedValue({ delivered: true }),
  DEFAULT_MAX_MESSAGE_LENGTH: 10000,
}));
vi.mock('../../../src/services/pipeline/prepare-context.js', () => ({
  prepareOrchestrationInputs: vi.fn().mockResolvedValue({
    catalog: { tools: [] },
    queryRules: '',
    schema: '',
    conversationHistory: [],
  }),
}));
vi.mock('../../../src/services/claude/system-prompt.js', () => ({
  buildSystemPrompt: vi.fn().mockReturnValue('system prompt'),
}));
vi.mock('../../../src/services/claude/tools.js', () => ({
  buildToolDefinitions: vi.fn().mockReturnValue([]),
}));
vi.mock('../../../src/services/mcp/catalog.js', () => ({
  generateToolCatalogMarkdown: vi.fn().mockReturnValue(''),
}));

import { processFredMessage } from '../../../src/services/message-handler.js';
import { createPipelineContext } from '../../../src/services/pipeline/setup.js';
import { orchestrate } from '../../../src/services/claude/orchestrator.js';
import { sendResponse, sendErrorMessage } from '../../../src/services/pipeline/send-response.js';

const BOT_EMAIL = 'bot@example.com';

const env = {
  ENVIRONMENT: 'test',
  ZULIP_BOT_EMAIL: BOT_EMAIL,
  ZULIP_BOT_API_KEY: 'test-key',
  ZULIP_WEBHOOK_TOKEN: 'test-token',
  ZULIP_SITE: 'https://chat.example.com',
  ANTHROPIC_API_KEY: 'test-anthropic-key',
  FRED_MCP_TOKEN: 'test-mcp-token',
  CONVERSATION_CACHE: {} as KVNamespace,
  FRED_DO: {} as DurableObjectNamespace,
};

const payload: ZulipWebhookPayload = {
  token: 'tok',
  message: {
    id: 1,
    sender_id: 5,
    sender_email: 'user@test.com',
    sender_full_name: 'User',
    content: 'hello',
    subject: 'general',
    stream_id: 42,
    display_recipient: 'engineering',
    type: 'stream',
    timestamp: 1700000000,
  },
  bot_email: BOT_EMAIL,
};

function rejectOnAbort(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(new DOMException('The operation was aborted', 'AbortError'));
    });
  });
}

function makeMockLogger(): RequestLogger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeMockClient(): ZulipClient {
  const client = new ZulipClient('https://chat.example.com', BOT_EMAIL, 'key');
  client.addReaction = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  client.removeReaction = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  return client;
}

function makeOrchestrationCtx(overrides?: Partial<OrchestrationContext>): OrchestrationContext {
  return {
    config: {
      model: 'claude-sonnet-4-6',
      maxTokens: 4096,
      maxIterations: 25,
      codeExecTimeoutMs: 30000,
      codeExecMemoryLimitBytes: 48 * 1024 * 1024,
      codeExecStackSizeBytes: 512 * 1024,
      maxMcpCallsPerExecution: 10,
      maxMcpCallsPerRequest: 50,
      fredMcpUrl: 'https://mcp.test',
    },
    mcpConfig: { id: 'fred-mcp', name: 'Fred', url: 'https://mcp.test', authToken: 'tok' },
    catalog: { tools: [] },
    healthTracker: new HealthTracker(),
    logger: makeMockLogger(),
    requestId: 'test-req',
    mcpCallCount: 0,
    iterations: 0,
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

function setupPipelineContext(orchestrationCtxOverrides?: Partial<OrchestrationContext>): {
  logger: RequestLogger;
  client: ZulipClient;
  orchestrationCtx: OrchestrationContext;
} {
  const logger = makeMockLogger();
  const client = makeMockClient();

  // createPipelineContext receives the real AbortSignal from processFredMessage.
  // We capture it so the mock orchestrationCtx uses the same signal, allowing
  // fake-timer-driven abort to reach the mock orchestrate implementation.
  let orchCtx: OrchestrationContext;

  vi.mocked(createPipelineContext).mockImplementation((_payload, _env, abortSignal, requestId) => {
    orchCtx = makeOrchestrationCtx({
      logger,
      abortSignal,
      requestId,
      ...orchestrationCtxOverrides,
    });
    const ctx: PipelineContext = {
      requestId: requestId ?? 'test-req',
      logger,
      client,
      orchestrationCtx: orchCtx,
      threadKey: 'channel:42:general',
      userMessage: 'hello',
    };
    return ctx;
  });

  // Return a proxy object so tests can read orchestrationCtx after
  // processFredMessage has called createPipelineContext.
  return {
    logger,
    client,
    get orchestrationCtx() {
      return orchCtx!;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('processFredMessage — failure paths', () => {
  it('sends error reply with request ID on uncaught throw', async () => {
    const { logger } = setupPipelineContext();
    vi.mocked(orchestrate).mockRejectedValue(new Error('something broke'));

    await processFredMessage(payload, env, 'test-req-456');

    expect(logger.error).toHaveBeenCalledWith(
      'orchestration_uncaught_throw',
      expect.objectContaining({
        error: 'something broke',
        error_name: 'Error',
        iterations: 0,
        stage: 'pipeline',
      })
    );
    expect(vi.mocked(sendErrorMessage)).toHaveBeenCalledWith(
      expect.any(Object),
      payload,
      BOT_EMAIL,
      logger,
      { detail: 'Request ID: test-req-456' }
    );
  });

  it('sends dedicated timeout reply when watchdog fires', async () => {
    const { logger } = setupPipelineContext();
    vi.mocked(orchestrate).mockImplementation((opts) => rejectOnAbort(opts.context.abortSignal));

    const promise = processFredMessage(payload, env, 'test-req-123');
    await vi.advanceTimersByTimeAsync(270_000);
    await promise;

    expect(logger.error).toHaveBeenCalledWith(
      'watchdog_fired',
      expect.objectContaining({
        iterations: 0,
      })
    );
    expect(vi.mocked(sendErrorMessage)).toHaveBeenCalledWith(
      expect.any(Object),
      payload,
      BOT_EMAIL,
      logger,
      expect.objectContaining({ text: expect.stringContaining('processing budget') })
    );
    // Verify request ID is in the timeout reply text
    const options = vi.mocked(sendErrorMessage).mock.calls[0][4] as { text: string };
    expect(options.text).toContain('test-req-123');
  });

  it('reads ORCHESTRATION_TIMEOUT_MS from env', async () => {
    const { logger } = setupPipelineContext();
    vi.mocked(orchestrate).mockImplementation((opts) => rejectOnAbort(opts.context.abortSignal));

    const envWithTimeout = { ...env, ORCHESTRATION_TIMEOUT_MS: '5000' };
    const promise = processFredMessage(payload, envWithTimeout, 'test-req');

    // Should NOT have timed out at 4999ms
    await vi.advanceTimersByTimeAsync(4999);
    expect(logger.error).not.toHaveBeenCalledWith('watchdog_fired', expect.any(Object));

    // Should time out at 5000ms
    await vi.advanceTimersByTimeAsync(1);
    await promise;

    expect(logger.error).toHaveBeenCalledWith('watchdog_fired', expect.any(Object));
  });

  it('includes iteration count in watchdog_fired log', async () => {
    const { logger } = setupPipelineContext();
    vi.mocked(orchestrate).mockImplementation((opts) => {
      opts.context.iterations = 3;
      return rejectOnAbort(opts.context.abortSignal);
    });

    const promise = processFredMessage(payload, env, 'test-req');
    await vi.advanceTimersByTimeAsync(270_000);
    await promise;

    expect(logger.error).toHaveBeenCalledWith(
      'watchdog_fired',
      expect.objectContaining({ iterations: 3 })
    );
  });

  it('includes iteration count in orchestration_uncaught_throw log', async () => {
    const { logger } = setupPipelineContext();
    vi.mocked(orchestrate).mockImplementation((opts) => {
      opts.context.iterations = 2;
      return Promise.reject(new Error('crash'));
    });

    await processFredMessage(payload, env, 'test-req');

    expect(logger.error).toHaveBeenCalledWith(
      'orchestration_uncaught_throw',
      expect.objectContaining({ iterations: 2 })
    );
  });

  it('fires watchdog even when orchestrate is mid-tool-call', async () => {
    // Simulates the case where orchestrate is blocked waiting on an MCP
    // tool call. The abort signal should propagate and cancel the call.
    const { logger } = setupPipelineContext();
    vi.mocked(orchestrate).mockImplementation((opts) => {
      opts.context.iterations = 1;
      // Simulate a tool call in flight — the abort signal propagates
      // through sendJsonRpc and cancels the fetch, which surfaces here.
      return rejectOnAbort(opts.context.abortSignal);
    });

    const envWithShortTimeout = { ...env, ORCHESTRATION_TIMEOUT_MS: '100' };
    const promise = processFredMessage(payload, envWithShortTimeout, 'test-req-tool');
    await vi.advanceTimersByTimeAsync(100);
    await promise;

    expect(logger.error).toHaveBeenCalledWith(
      'watchdog_fired',
      expect.objectContaining({ iterations: 1 })
    );
    const options = vi.mocked(sendErrorMessage).mock.calls[0][4] as { text: string };
    expect(options.text).toContain('test-req-tool');
  });
});

describe('processFredMessage — response delivery', () => {
  // A run cut off by the output ceiling must not reuse the generic failure text — that is
  // what Dane saw on the Transform Iran reports, and "try again" is wrong advice for it.
  it('sends a truncation reply, not the generic error, when the output ceiling is hit', async () => {
    const { logger } = setupPipelineContext();
    vi.mocked(orchestrate).mockResolvedValue({
      response: '',
      iterations: 2,
      totalInputTokens: 100,
      totalOutputTokens: 4096,
      stopReason: 'max_tokens',
      truncated: true,
    });

    await processFredMessage(payload, env, 'test-req-trunc');

    expect(logger.warn).toHaveBeenCalledWith(
      'orchestration_empty_response',
      expect.objectContaining({ stop_reason: 'max_tokens', truncated: true })
    );

    const options = vi.mocked(sendErrorMessage).mock.calls[0][4] as {
      text?: string;
      detail?: string;
    };
    expect(options.detail).toBeUndefined();
    expect(options.text).toContain('ran out of room');
    expect(options.text).toContain('test-req-trunc');
  });

  // A max_tokens stop can end a turn with a non-empty prefix and no tool call. Posting that
  // bare would present a cut-off report as finished, with no signal that rows are missing.
  it('appends a truncation notice to a partial answer instead of posting it as complete', async () => {
    const { logger } = setupPipelineContext();
    vi.mocked(orchestrate).mockResolvedValue({
      response: 'Overall Product Status\n- OBS: 12 complete',
      iterations: 3,
      totalInputTokens: 100,
      totalOutputTokens: 4096,
      stopReason: 'max_tokens',
      truncated: true,
    });

    await processFredMessage(payload, env, 'test-req-partial');

    // Delivered as a normal response, not routed to the error path.
    expect(vi.mocked(sendErrorMessage)).not.toHaveBeenCalled();
    expect(vi.mocked(sendResponse)).toHaveBeenCalled();

    const sent = vi.mocked(sendResponse).mock.calls[0][1] as string;
    expect(sent).toContain('Overall Product Status');
    expect(sent).toContain('incomplete');
    expect(sent).toContain('test-req-partial');
    expect(logger.warn).toHaveBeenCalledWith(
      'response_truncated_notice_appended',
      expect.objectContaining({ total_output_tokens: 4096 })
    );
  });

  it('posts a complete answer unchanged, with no truncation notice', async () => {
    setupPipelineContext();
    vi.mocked(orchestrate).mockResolvedValue({
      response: 'Here is the full report.',
      iterations: 2,
      totalInputTokens: 100,
      totalOutputTokens: 500,
      stopReason: 'end_turn',
      truncated: false,
    });

    await processFredMessage(payload, env, 'test-req-ok');

    const sent = vi.mocked(sendResponse).mock.calls[0][1] as string;
    expect(sent).toBe('Here is the full report.');
    expect(sent).not.toContain('incomplete');
  });

  it('passes the Zulip message-length limit through to sendResponse', async () => {
    setupPipelineContext();
    vi.mocked(orchestrate).mockResolvedValue({
      response: 'Short answer.',
      iterations: 1,
      totalInputTokens: 10,
      totalOutputTokens: 10,
      stopReason: 'end_turn',
      truncated: false,
    });

    await processFredMessage(
      { ...payload },
      { ...env, ZULIP_MAX_MESSAGE_LENGTH: '4000' },
      'req-lim'
    );

    expect(vi.mocked(sendResponse).mock.calls[0][3]).toBe(4000);
  });

  it('keeps the generic error for an empty response that was not truncated', async () => {
    setupPipelineContext();
    vi.mocked(orchestrate).mockResolvedValue({
      response: '',
      iterations: 1,
      totalInputTokens: 100,
      totalOutputTokens: 10,
      stopReason: 'end_turn',
      truncated: false,
    });

    await processFredMessage(payload, env, 'test-req-empty');

    const options = vi.mocked(sendErrorMessage).mock.calls[0][4] as {
      text?: string;
      detail?: string;
    };
    expect(options.detail).toBe('no response generated');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { executeToolCalls } from '../../../../src/services/claude/tool-execution.js';
import type { ToolUseBlock, OrchestrationContext } from '../../../../src/services/claude/types.js';
import { HealthTracker } from '../../../../src/services/mcp/health.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

describe('executeToolCalls', () => {
  let originalFetch: typeof globalThis.fetch;
  const logger: RequestLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeContext(): OrchestrationContext {
    return {
      config: {
        model: 'claude-sonnet-4-6',
        maxTokens: 4096,
        maxIterations: 25,
        codeExecTimeoutMs: 30000,
        maxMcpCallsPerExecution: 10,
        maxMcpCallsPerRequest: 50,
        fredMcpUrl: 'https://mcp.test',
      },
      mcpConfig: { id: 'fred-mcp', name: 'Fred', url: 'https://mcp.test', authToken: 'tok' },
      catalog: {
        tools: [
          {
            name: 'list_tables',
            description: 'List tables',
            serverId: 'fred-mcp',
            inputSchema: {},
          },
        ],
      },
      healthTracker: new HealthTracker(),
      logger,
      requestId: 'test-req',
      mcpCallCount: 0,
      abortSignal: new AbortController().signal,
    };
  }

  it('executes tool calls in parallel', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'data' }] },
        })
      )
    );

    const toolCalls: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'list_tables', input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'list_tables', input: {} },
    ];

    const results = await executeToolCalls(toolCalls, makeContext());

    expect(results).toHaveLength(2);
    expect(results[0].tool_use_id).toBe('tu_1');
    expect(results[1].tool_use_id).toBe('tu_2');
    expect(results[0].content).toBe('data');
  });

  it('returns error result for unknown tool', async () => {
    const toolCalls: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'nonexistent', input: {} },
    ];

    const results = await executeToolCalls(toolCalls, makeContext());

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain('Unknown tool');
  });

  it('truncates large tool results', async () => {
    const largeText = 'x'.repeat(40000);
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: largeText }] },
        })
      )
    );

    const toolCalls: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'list_tables', input: {} },
    ];

    const results = await executeToolCalls(toolCalls, makeContext());
    expect(results[0].content.length).toBeLessThan(40000);
    expect(results[0].content).toContain('truncated');
  });

  it('handles MCP errors gracefully', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network error'));

    const toolCalls: ToolUseBlock[] = [
      { type: 'tool_use', id: 'tu_1', name: 'list_tables', input: {} },
    ];

    const results = await executeToolCalls(toolCalls, makeContext());

    expect(results[0].is_error).toBe(true);
    expect(results[0].content).toContain('Error');
    expect(results[0].content).toContain('network error');
  });
});

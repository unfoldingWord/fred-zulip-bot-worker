import type { ToolUseBlock, OrchestrationContext } from './types.js';
import { callTool } from '../mcp/call-tool.js';
import { findTool } from '../mcp/catalog.js';
import { executeCode } from '../code-execution/quickjs-executor.js';
import type { HostFunction } from '../code-execution/types.js';

export async function dispatchToolCall(
  toolCall: ToolUseBlock,
  ctx: OrchestrationContext
): Promise<string> {
  const { catalog, mcpConfig, healthTracker, logger } = ctx;

  if (toolCall.name === 'execute_code') {
    return dispatchCodeExecution(toolCall, ctx);
  }

  const tool = findTool(catalog, toolCall.name);
  if (!tool) {
    return `Error: Unknown tool "${toolCall.name}"`;
  }

  if (!healthTracker.isHealthy) {
    return 'Error: Fred database is temporarily unavailable. Please try again later.';
  }

  if (ctx.mcpCallCount >= ctx.config.maxMcpCallsPerRequest) {
    return `Error: MCP call limit (${ctx.config.maxMcpCallsPerRequest}) reached for this request.`;
  }

  ctx.mcpCallCount++;
  const result = await callTool(mcpConfig, toolCall.name, toolCall.input, logger);

  if (result.isError) {
    healthTracker.recordFailure(logger);
    return `Error: ${result.content}`;
  }

  healthTracker.recordSuccess(logger);
  return result.content;
}

async function dispatchCodeExecution(
  toolCall: ToolUseBlock,
  ctx: OrchestrationContext
): Promise<string> {
  const input = toolCall.input as { code?: string };
  if (!input.code) return 'Error: No code provided';

  const hostFunctions = buildHostFunctions(ctx);
  const result = await executeCode(
    input.code,
    hostFunctions,
    {
      timeoutMs: ctx.config.codeExecTimeoutMs,
      maxMcpCallsPerExecution: ctx.config.maxMcpCallsPerExecution,
    },
    ctx.logger
  );

  if (!result.success) return `Error: ${result.error}`;
  return JSON.stringify(result.result ?? result.console_output);
}

function buildHostFunctions(ctx: OrchestrationContext): Record<string, HostFunction> {
  const fns: Record<string, HostFunction> = {};
  for (const tool of ctx.catalog.tools) {
    fns[tool.name] = async (args: unknown) => {
      ctx.mcpCallCount++;
      const result = await callTool(ctx.mcpConfig, tool.name, args, ctx.logger);
      return result.content;
    };
  }
  return fns;
}

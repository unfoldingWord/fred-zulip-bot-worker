import type { ToolUseBlock, OrchestrationContext } from './types.js';
import { callTool } from '../mcp/call-tool.js';
import { findTool } from '../mcp/catalog.js';

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

  // Phase 6 will implement QuickJS execution
  ctx.logger.warn('code_execution_not_implemented', { code_length: input.code.length });
  return 'Error: Code execution is not yet available.';
}

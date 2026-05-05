import type { ToolUseBlock, OrchestrationContext } from './types.js';
import { callTool } from '../mcp/call-tool.js';
import { findTool } from '../mcp/catalog.js';

export async function dispatchToolCall(
  toolCall: ToolUseBlock,
  ctx: OrchestrationContext
): Promise<string> {
  const { catalog, mcpConfig, healthTracker, logger } = ctx;

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

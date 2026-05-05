import type { ToolUseBlock, ToolResultBlock, OrchestrationContext } from './types.js';
import { dispatchToolCall } from './tool-dispatch.js';
import { truncateToolResult } from './truncation.js';

export async function executeToolCalls(
  toolCalls: ToolUseBlock[],
  ctx: OrchestrationContext
): Promise<ToolResultBlock[]> {
  const results = await Promise.all(toolCalls.map((tc) => executeSingleTool(tc, ctx)));
  return results;
}

async function executeSingleTool(
  toolCall: ToolUseBlock,
  ctx: OrchestrationContext
): Promise<ToolResultBlock> {
  try {
    const raw = await dispatchToolCall(toolCall, ctx);
    const content = truncateToolResult(raw, toolCall.name, ctx.logger);
    const isError = raw.startsWith('Error:');

    const result: ToolResultBlock = { type: 'tool_result', tool_use_id: toolCall.id, content };
    if (isError) result.is_error = true;
    return result;
  } catch (e) {
    ctx.logger.error('tool_execution_error', {
      tool_name: toolCall.name,
      error: String(e),
    });

    return {
      type: 'tool_result',
      tool_use_id: toolCall.id,
      content: `Error executing ${toolCall.name}: ${String(e)}`,
      is_error: true,
    };
  }
}

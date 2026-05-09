import type { ToolUseBlock, OrchestrationContext } from './types.js';
import { callTool } from '../mcp/call-tool.js';
import { findTool, getToolNames } from '../mcp/catalog.js';
import { createMCPHostFunctions, executeCode } from '../code-execution/index.js';
import type { CodeExecutionResult } from '../code-execution/index.js';

const CODE_PREVIEW_LEN = 200;
const STACK_LOG_LEN = 500;

export async function dispatchToolCall(
  toolCall: ToolUseBlock,
  ctx: OrchestrationContext
): Promise<string> {
  if (toolCall.name === 'execute_code') {
    return handleExecuteCode(toolCall, ctx);
  }
  return dispatchMCPToolCall(toolCall.name, toolCall.input, ctx);
}

async function dispatchMCPToolCall(
  toolName: string,
  toolInput: unknown,
  ctx: OrchestrationContext
): Promise<string> {
  const { catalog, mcpConfig, healthTracker, logger } = ctx;

  const tool = findTool(catalog, toolName);
  if (!tool) {
    return `Error: Unknown tool "${toolName}"`;
  }

  if (!healthTracker.isHealthy) {
    return 'Error: Fred database is temporarily unavailable. Please try again later.';
  }

  if (ctx.mcpCallCount >= ctx.config.maxMcpCallsPerRequest) {
    logger.warn('execute_code_request_cap_blocked', {
      tool_name: toolName,
      mcp_call_count: ctx.mcpCallCount,
      max_per_request: ctx.config.maxMcpCallsPerRequest,
    });
    return `Error: MCP call limit (${ctx.config.maxMcpCallsPerRequest}) reached for this request.`;
  }

  ctx.mcpCallCount++;
  const result = await callTool(mcpConfig, toolName, toolInput, logger, {
    signal: ctx.abortSignal,
  });

  if (result.isError) {
    healthTracker.recordFailure(logger);
    return `Error: ${result.content}`;
  }

  healthTracker.recordSuccess(logger);
  return result.content;
}

function isExecuteCodeInput(input: unknown): input is { code: string } {
  return (
    typeof input === 'object' &&
    input !== null &&
    'code' in input &&
    typeof (input as { code: unknown }).code === 'string'
  );
}

function buildSandboxToolCaller(
  ctx: OrchestrationContext
): (toolName: string, args: unknown) => Promise<unknown> {
  return async (toolName, args) => {
    const content = await dispatchMCPToolCall(toolName, args, ctx);
    if (content.startsWith('Error:')) {
      throw new Error(content);
    }
    return content;
  };
}

async function runSandbox(
  code: string,
  ctx: OrchestrationContext,
  toolUseId: string
): Promise<CodeExecutionResult | { crashed: true; message: string }> {
  const toolNames = getToolNames(ctx.catalog);
  const hostFunctions = createMCPHostFunctions(buildSandboxToolCaller(ctx), toolNames);
  try {
    return await executeCode(
      code,
      {
        timeout_ms: ctx.config.codeExecTimeoutMs,
        hostFunctions,
        maxMcpCalls: ctx.config.maxMcpCallsPerExecution,
        memoryLimitBytes: ctx.config.codeExecMemoryLimitBytes,
        stackSizeBytes: ctx.config.codeExecStackSizeBytes,
      },
      ctx.logger
    );
  } catch (e) {
    ctx.logger.error('execute_code_dispatch_error', {
      tool_use_id: toolUseId,
      error: e instanceof Error ? e.message : String(e),
      error_name: e instanceof Error ? e.name : 'Unknown',
      stack: e instanceof Error && e.stack ? e.stack.slice(0, STACK_LOG_LEN) : undefined,
    });
    return { crashed: true, message: e instanceof Error ? e.message : String(e) };
  }
}

async function handleExecuteCode(
  toolCall: ToolUseBlock,
  ctx: OrchestrationContext
): Promise<string> {
  const { logger } = ctx;

  if (!isExecuteCodeInput(toolCall.input)) {
    logger.warn('execute_code_dispatch_error', {
      tool_use_id: toolCall.id,
      error: 'Invalid input: expected { code: string }',
      error_name: 'ValidationError',
    });
    return 'Error: execute_code expected input { code: string }';
  }

  const { code } = toolCall.input;
  const toolNames = getToolNames(ctx.catalog);

  logger.log('execute_code_dispatch_start', {
    tool_use_id: toolCall.id,
    code_length: code.length,
    code_preview: code.slice(0, CODE_PREVIEW_LEN),
    available_tools_count: toolNames.length,
  });

  const dispatchStart = Date.now();
  const sandboxResult = await runSandbox(code, ctx, toolCall.id);

  if ('crashed' in sandboxResult) {
    return `Error: execute_code crashed: ${sandboxResult.message}`;
  }

  const result = sandboxResult;
  const resultPayload = formatExecutionResult(result);

  logger.log('execute_code_dispatch_complete', {
    tool_use_id: toolCall.id,
    duration_ms: Date.now() - dispatchStart,
    success: result.success,
    mcp_calls_made: result.callsMade ?? 0,
    console_logs_count: result.logs.length,
    result_size: resultPayload.length,
    error_code: result.errorCode,
  });

  return resultPayload;
}

function formatExecutionResult(result: CodeExecutionResult): string {
  if (!result.success) {
    const codeSuffix = result.errorCode ? ` [${result.errorCode}]` : '';
    return `Error: ${result.error ?? 'execute_code failed'}${codeSuffix}`;
  }
  const payload = {
    result: result.result,
    logs: result.logs.map((l) => ({ level: l.level, message: l.message })),
    duration_ms: result.duration_ms,
    ...(result.callsMade !== undefined && {
      mcp_calls_made: result.callsMade,
      mcp_call_limit: result.callLimit,
    }),
  };
  try {
    return JSON.stringify(payload);
  } catch (e) {
    return `Error: execute_code result could not be serialized: ${e instanceof Error ? e.message : String(e)}`;
  }
}

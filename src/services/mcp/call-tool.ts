import type { RequestLogger } from '../../utils/logger.js';
import type { MCPServerConfig, MCPToolCallResult } from './types.js';
import { sendJsonRpc } from './client.js';

const MAX_RESPONSE_SIZE = 1_048_576; // 1MB

export async function callTool(
  config: MCPServerConfig,
  toolName: string,
  args: unknown,
  logger: RequestLogger,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<MCPToolCallResult> {
  const startMs = Date.now();
  logger.log('tool_call_start', {
    server: config.id,
    tool_name: toolName,
    input_size: JSON.stringify(args).length,
  });

  const response = await sendJsonRpc({
    url: config.url,
    method: 'tools/call',
    params: { name: toolName, arguments: args },
    token: config.authToken,
    logger,
    timeoutMs: options?.timeoutMs ?? 30000,
    signal: options?.signal,
  });

  const durationMs = Date.now() - startMs;

  if (response.error) {
    return buildErrorResult(toolName, response.error.message, durationMs, logger);
  }

  return buildSuccessResult(toolName, response.result, durationMs, logger);
}

function buildErrorResult(
  toolName: string,
  message: string,
  durationMs: number,
  logger: RequestLogger
): MCPToolCallResult {
  logger.error('tool_call_error', { tool_name: toolName, error: message, duration_ms: durationMs });
  return { content: message, isError: true, meta: { duration_ms: durationMs, response_size: 0 } };
}

function buildSuccessResult(
  toolName: string,
  result: unknown,
  durationMs: number,
  logger: RequestLogger
): MCPToolCallResult {
  const content = extractContent(result);
  if (content.length > MAX_RESPONSE_SIZE) {
    logger.warn('tool_response_too_large', {
      tool_name: toolName,
      size: content.length,
      cap: MAX_RESPONSE_SIZE,
    });
  }
  logger.log('tool_call_complete', {
    tool_name: toolName,
    output_size: content.length,
    duration_ms: durationMs,
  });
  return {
    content,
    isError: false,
    meta: { duration_ms: durationMs, response_size: content.length },
  };
}

function extractContent(result: unknown): string {
  if (!result || typeof result !== 'object') return String(result ?? '');
  const obj = result as { content?: unknown[] };
  if (!Array.isArray(obj.content)) return JSON.stringify(result);

  return obj.content
    .filter((c): c is { text: string } => typeof c === 'object' && c !== null && 'text' in c)
    .map((c) => c.text)
    .join('\n');
}

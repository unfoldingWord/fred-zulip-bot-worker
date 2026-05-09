import type { RequestLogger } from '../../utils/logger.js';
import type { JsonRpcRequest, JsonRpcResponse } from './types.js';

const DEFAULT_TIMEOUT_MS = 30000;

export interface JsonRpcOptions {
  url: string;
  method: string;
  params: unknown;
  token: string;
  logger: RequestLogger;
  timeoutMs?: number;
  signal?: AbortSignal | undefined;
}

export async function sendJsonRpc(options: JsonRpcOptions): Promise<JsonRpcResponse> {
  const { url, method, params, token, logger } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const request: JsonRpcRequest = {
    jsonrpc: '2.0',
    method,
    params: params ?? undefined,
    id: Date.now(),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onParentAbort);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      logger.error('mcp_http_error', { url, method, status: response.status });
      return buildErrorResponse(request.id, response.status, `HTTP ${response.status}`);
    }

    return (await response.json()) as JsonRpcResponse;
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === 'AbortError';
    logger.error('mcp_request_failed', { url, method, error: String(e), timeout: isAbort });
    return buildErrorResponse(request.id, -1, isAbort ? 'Timeout' : String(e));
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}

function buildErrorResponse(id: number, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

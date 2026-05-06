import type { RequestLogger } from '../../utils/logger.js';
import type { MCPServerConfig } from './types.js';
import { sendJsonRpc } from './client.js';

/**
 * Fetch an MCP prompt by name and return its message text concatenated as a
 * single string. Standard MCP prompt protocol: `prompts/get` returns
 * `{ messages: [{ role, content: { type: 'text', text } }] }`. We join all
 * text-content blocks with blank-line separators and return them.
 *
 * Returns empty string on any failure (server doesn't support prompts, prompt
 * not found, network error, malformed response). The caller treats empty as
 * "no rules available" and the system-prompt builder skips the section.
 */
export async function fetchPromptText(
  config: MCPServerConfig,
  promptName: string,
  logger: RequestLogger
): Promise<string> {
  const startMs = Date.now();
  logger.log('mcp_prompt_fetch_start', { server: config.id, prompt: promptName });

  const response = await sendJsonRpc({
    url: config.url,
    method: 'prompts/get',
    params: { name: promptName, arguments: {} },
    token: config.authToken,
    logger,
  });

  if (response.error) {
    logger.warn('mcp_prompt_fetch_error', {
      server: config.id,
      prompt: promptName,
      error: response.error.message,
      duration_ms: Date.now() - startMs,
    });
    return '';
  }

  const text = extractPromptText(response.result);
  logger.log('mcp_prompt_fetch_complete', {
    server: config.id,
    prompt: promptName,
    text_length: text.length,
    duration_ms: Date.now() - startMs,
  });
  return text;
}

function extractPromptText(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const obj = result as { messages?: unknown[] };
  if (!Array.isArray(obj.messages)) return '';

  const texts: string[] = [];
  for (const msg of obj.messages) {
    if (!msg || typeof msg !== 'object') continue;
    const content = (msg as { content?: unknown }).content;
    const text = extractContentText(content);
    if (text) texts.push(text);
  }
  return texts.join('\n\n').trim();
}

function extractContentText(content: unknown): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (typeof content !== 'object') return '';
  const obj = content as { type?: string; text?: unknown };
  if (obj.type === 'text' && typeof obj.text === 'string') return obj.text;
  return '';
}

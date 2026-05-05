import type { RequestLogger } from '../../utils/logger.js';

const TOOL_RESULT_CAP = 32 * 1024; // 32KB
const BODY_SIZE_CAP = 200 * 1024; // 200KB

export function truncateToolResult(
  content: string,
  toolName: string,
  logger: RequestLogger
): string {
  if (content.length <= TOOL_RESULT_CAP) return content;

  logger.log('tool_result_truncated', {
    tool_name: toolName,
    original_size: content.length,
    cap: TOOL_RESULT_CAP,
  });

  const truncated = content.slice(0, TOOL_RESULT_CAP);
  return truncated + '\n\n[Result truncated. Original size: ' + content.length + ' chars]';
}

export function assertBodySize(body: string, logger: RequestLogger): void {
  if (body.length > BODY_SIZE_CAP) {
    logger.warn('request_body_oversized', {
      size: body.length,
      cap: BODY_SIZE_CAP,
    });
  }
}

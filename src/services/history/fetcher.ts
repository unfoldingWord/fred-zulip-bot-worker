import type { ZulipClient } from '../zulip/client.js';
import type { ZulipMessage } from '../zulip/types.js';
import type { ZulipHistoryMessage } from './types.js';
import type { RequestLogger } from '../../utils/logger.js';

export async function fetchHistory(
  client: ZulipClient,
  message: ZulipMessage,
  logger: RequestLogger,
  limit: number = 20
): Promise<ZulipHistoryMessage[]> {
  const narrow = buildNarrow(message);
  const startMs = Date.now();
  logger.log('history_fetch_start', { narrow_type: narrow[0]?.operator });

  const response = await client.getMessages({
    narrow,
    anchor: 'newest',
    num_before: limit,
    num_after: 0,
  });

  if (!response.ok) {
    logger.error('history_fetch_error', {
      status: response.status,
      duration_ms: Date.now() - startMs,
    });
    return [];
  }

  const data = (await response.json()) as { messages?: ZulipHistoryMessage[] };
  const messages = data.messages ?? [];

  logger.log('history_fetch_complete', {
    message_count: messages.length,
    duration_ms: Date.now() - startMs,
  });

  return messages;
}

function buildNarrow(message: ZulipMessage): Array<{ operator: string; operand: string | number }> {
  if (message.type === 'stream' && message.stream_id !== undefined) {
    return [
      { operator: 'channel', operand: message.stream_id },
      { operator: 'topic', operand: message.subject },
    ];
  }

  if (Array.isArray(message.display_recipient)) {
    const ids = message.display_recipient.map((u) => u.id).sort((a, b) => a - b);
    return [{ operator: 'dm', operand: ids.join(',') }];
  }

  return [{ operator: 'topic', operand: message.subject }];
}

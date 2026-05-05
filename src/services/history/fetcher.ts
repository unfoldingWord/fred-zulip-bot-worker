import type { ZulipClient } from '../zulip/client.js';
import type { ZulipMessage } from '../zulip/types.js';
import type { ZulipHistoryMessage } from './types.js';
import type { RequestLogger } from '../../utils/logger.js';
import { otherParticipantIds } from '../zulip/recipients.js';

type Narrow = Array<{ operator: string; operand: string | number }>;

export async function fetchHistory(
  client: ZulipClient,
  message: ZulipMessage,
  botEmail: string,
  logger: RequestLogger,
  limit: number = 20
): Promise<ZulipHistoryMessage[]> {
  const narrow = buildNarrow(message, botEmail);
  if (narrow === null) {
    logger.log('history_fetch_skipped', { reason: 'no_other_participants' });
    return [];
  }

  const startMs = Date.now();
  logger.log('history_fetch_start', { narrow_type: narrow[0]?.operator });

  const response = await client.getMessages({
    narrow,
    anchor: message.id,
    include_anchor: false,
    num_before: limit,
    num_after: 0,
    apply_markdown: false,
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

function buildNarrow(message: ZulipMessage, botEmail: string): Narrow | null {
  if (message.type === 'stream' && message.stream_id !== undefined) {
    return [
      { operator: 'channel', operand: message.stream_id },
      { operator: 'topic', operand: message.subject },
    ];
  }

  if (Array.isArray(message.display_recipient)) {
    const ids = otherParticipantIds(message, botEmail);
    if (ids.length === 0) return null;
    return [{ operator: 'dm', operand: ids.join(',') }];
  }

  return [{ operator: 'topic', operand: message.subject }];
}

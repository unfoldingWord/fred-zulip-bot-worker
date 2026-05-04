import type { ZulipMessage } from './types.js';

/**
 * Derives a unique conversation thread key from a Zulip message.
 *
 * - Channel messages: `channel:{stream_id}:{subject}`
 * - DMs (1:1 or group): `dm:{sorted_participant_ids}`
 */
export function deriveThreadKey(message: ZulipMessage): string {
  if (message.type === 'stream' && message.stream_id !== undefined) {
    return `channel:${message.stream_id}:${message.subject}`;
  }

  if (Array.isArray(message.display_recipient)) {
    const ids = message.display_recipient.map((u) => u.id).sort((a, b) => a - b);
    return `dm:${ids.join(',')}`;
  }

  return `unknown:${message.id}`;
}

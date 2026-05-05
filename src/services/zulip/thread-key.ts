import type { ZulipMessage } from './types.js';
import { otherParticipantIds } from './recipients.js';

/**
 * Derives a unique conversation thread key from a Zulip message.
 *
 * - Channel messages: `channel:{stream_id}:{subject}`
 * - DMs (1:1 or group): `dm:{sorted_other_participant_ids}` — the bot itself
 *   is excluded so the key matches the canonical `dm` narrow operand.
 */
export function deriveThreadKey(message: ZulipMessage, botEmail: string): string {
  if (message.type === 'stream' && message.stream_id !== undefined) {
    return `channel:${message.stream_id}:${message.subject}`;
  }

  if (Array.isArray(message.display_recipient)) {
    return `dm:${otherParticipantIds(message, botEmail).join(',')}`;
  }

  return `unknown:${message.id}`;
}

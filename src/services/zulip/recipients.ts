import type { ZulipMessage } from './types.js';

/**
 * Sorted user IDs of the OTHER participants in a DM — the bot's own entry is
 * removed. Zulip's `dm` narrow operand and the `to` field of a direct-message
 * send both expect the other participants only.
 */
export function otherParticipantIds(message: ZulipMessage, botEmail: string): number[] {
  if (!Array.isArray(message.display_recipient)) return [];
  return message.display_recipient
    .filter((u) => u.email !== botEmail)
    .map((u) => u.id)
    .sort((a, b) => a - b);
}

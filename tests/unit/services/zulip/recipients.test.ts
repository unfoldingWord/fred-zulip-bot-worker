import { describe, it, expect } from 'vitest';
import { otherParticipantIds } from '../../../../src/services/zulip/recipients.js';
import type { ZulipMessage } from '../../../../src/services/zulip/types.js';

const BOT = 'bot@test.com';

function makeMessage(overrides: Partial<ZulipMessage>): ZulipMessage {
  return {
    id: 1,
    sender_id: 5,
    sender_email: 'user@test.com',
    sender_full_name: 'User',
    content: 'hi',
    subject: '',
    display_recipient: 'channel-name',
    type: 'private',
    timestamp: 1700000000,
    ...overrides,
  };
}

describe('otherParticipantIds', () => {
  it('returns the other user id for a 1:1 DM', () => {
    const msg = makeMessage({
      display_recipient: [
        { id: 5, email: 'user@test.com', full_name: 'User' },
        { id: 10, email: BOT, full_name: 'Bot' },
      ],
    });
    expect(otherParticipantIds(msg, BOT)).toEqual([5]);
  });

  it('returns sorted other ids for a group DM', () => {
    const msg = makeMessage({
      display_recipient: [
        { id: 20, email: 'alice@test.com', full_name: 'Alice' },
        { id: 5, email: 'bob@test.com', full_name: 'Bob' },
        { id: 12, email: BOT, full_name: 'Bot' },
      ],
    });
    expect(otherParticipantIds(msg, BOT)).toEqual([5, 20]);
  });

  it('returns empty array when only the bot is listed', () => {
    const msg = makeMessage({
      display_recipient: [{ id: 10, email: BOT, full_name: 'Bot' }],
    });
    expect(otherParticipantIds(msg, BOT)).toEqual([]);
  });

  it('returns empty array for a non-DM message (display_recipient is a string)', () => {
    const msg = makeMessage({ type: 'stream', display_recipient: 'engineering' });
    expect(otherParticipantIds(msg, BOT)).toEqual([]);
  });
});

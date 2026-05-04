import { describe, it, expect } from 'vitest';
import { deriveThreadKey } from '../../../../src/services/zulip/thread-key.js';
import type { ZulipMessage } from '../../../../src/services/zulip/types.js';

describe('deriveThreadKey', () => {
  it('returns channel key for stream messages', () => {
    const message: ZulipMessage = {
      id: 1,
      sender_id: 5,
      sender_email: 'user@example.com',
      sender_full_name: 'User',
      content: 'hello',
      subject: 'bug-report',
      stream_id: 42,
      display_recipient: 'engineering',
      type: 'stream',
      timestamp: 1700000000,
    };

    expect(deriveThreadKey(message)).toBe('channel:42:bug-report');
  });

  it('returns dm key with sorted IDs for 1:1 DM', () => {
    const message: ZulipMessage = {
      id: 2,
      sender_id: 15,
      sender_email: 'user@example.com',
      sender_full_name: 'User',
      content: 'hello',
      subject: '',
      display_recipient: [
        { id: 15, email: 'user@example.com', full_name: 'User' },
        { id: 3, email: 'bot@example.com', full_name: 'Bot' },
      ],
      type: 'private',
      timestamp: 1700000000,
    };

    expect(deriveThreadKey(message)).toBe('dm:3,15');
  });

  it('returns dm key with sorted IDs for group DM', () => {
    const message: ZulipMessage = {
      id: 3,
      sender_id: 20,
      sender_email: 'alice@example.com',
      sender_full_name: 'Alice',
      content: 'hello everyone',
      subject: '',
      display_recipient: [
        { id: 20, email: 'alice@example.com', full_name: 'Alice' },
        { id: 5, email: 'bob@example.com', full_name: 'Bob' },
        { id: 12, email: 'bot@example.com', full_name: 'Bot' },
      ],
      type: 'direct',
      timestamp: 1700000000,
    };

    expect(deriveThreadKey(message)).toBe('dm:5,12,20');
  });

  it('returns unknown key as fallback', () => {
    const message: ZulipMessage = {
      id: 99,
      sender_id: 1,
      sender_email: 'user@example.com',
      sender_full_name: 'User',
      content: 'hello',
      subject: '',
      display_recipient: 'some-channel',
      type: 'private',
      timestamp: 1700000000,
    };

    expect(deriveThreadKey(message)).toBe('unknown:99');
  });
});

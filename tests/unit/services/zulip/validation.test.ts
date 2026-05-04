import { describe, it, expect } from 'vitest';
import { validateWebhookPayload } from '../../../../src/services/zulip/validation.js';

describe('validateWebhookPayload', () => {
  const validStreamPayload = {
    bot_email: 'fred-bot@chat.example.com',
    bot_full_name: 'Fred',
    data: '@**Fred** hello',
    token: 'secret-token',
    trigger: 'mention',
    message: {
      id: 1,
      sender_id: 5,
      sender_email: 'user@example.com',
      sender_full_name: 'Test User',
      content: 'hello',
      subject: 'general',
      stream_id: 10,
      display_recipient: 'engineering',
      type: 'stream',
      timestamp: 1700000000,
    },
  };

  const validDmPayload = {
    bot_email: 'fred-bot@chat.example.com',
    bot_full_name: 'Fred',
    data: 'hello',
    token: 'secret-token',
    trigger: 'direct_message',
    message: {
      id: 2,
      sender_id: 5,
      sender_email: 'user@example.com',
      sender_full_name: 'Test User',
      content: 'hello',
      subject: '',
      display_recipient: [
        { id: 5, email: 'user@example.com', full_name: 'Test User' },
        { id: 10, email: 'fred-bot@chat.example.com', full_name: 'Fred' },
      ],
      type: 'private',
      timestamp: 1700000000,
    },
  };

  it('validates a stream message payload', () => {
    const result = validateWebhookPayload(validStreamPayload);
    expect(result.success).toBe(true);
  });

  it('validates a DM payload with array display_recipient', () => {
    const result = validateWebhookPayload(validDmPayload);
    expect(result.success).toBe(true);
  });

  it('accepts direct as message type', () => {
    const payload = {
      ...validDmPayload,
      message: { ...validDmPayload.message, type: 'direct' },
    };
    const result = validateWebhookPayload(payload);
    expect(result.success).toBe(true);
  });

  it('rejects missing token field', () => {
    const { token: _, ...noToken } = validStreamPayload;
    const result = validateWebhookPayload(noToken);
    expect(result.success).toBe(false);
  });

  it('rejects missing message field', () => {
    const { message: _, ...noMessage } = validStreamPayload;
    const result = validateWebhookPayload(noMessage);
    expect(result.success).toBe(false);
  });

  it('rejects invalid message type', () => {
    const payload = {
      ...validStreamPayload,
      message: { ...validStreamPayload.message, type: 'invalid' },
    };
    const result = validateWebhookPayload(payload);
    expect(result.success).toBe(false);
  });

  it('rejects null input', () => {
    const result = validateWebhookPayload(null);
    expect(result.success).toBe(false);
  });
});

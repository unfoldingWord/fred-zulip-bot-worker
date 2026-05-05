import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

function buildValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    bot_email: 'fred-bot@chat.example.com',
    bot_full_name: 'Fred',
    data: '@**Fred** hello',
    token: 'test-webhook-token',
    trigger: 'mention',
    message: {
      id: 42,
      sender_id: 7,
      sender_email: 'user@example.com',
      sender_full_name: 'Test User',
      content: 'hello',
      subject: 'general',
      stream_id: 1,
      display_recipient: 'engineering',
      type: 'stream',
      timestamp: 1700000000,
    },
    ...overrides,
  };
}

describe('POST /api/v1/zulip/webhook', () => {
  it('returns response_not_required for valid payload', async () => {
    const response = await SELF.fetch('http://localhost/api/v1/zulip/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildValidPayload()),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ response_not_required: true });
  });

  it('returns 401 for invalid token', async () => {
    const response = await SELF.fetch('http://localhost/api/v1/zulip/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildValidPayload({ token: 'wrong-token' })),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toEqual({ error: 'Invalid token' });
  });

  it('returns 400 for malformed JSON', async () => {
    const response = await SELF.fetch('http://localhost/api/v1/zulip/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json at all',
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: 'Invalid JSON body' });
  });

  it('returns 400 for missing required fields', async () => {
    const response = await SELF.fetch('http://localhost/api/v1/zulip/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'test-webhook-token' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toEqual({ error: 'Invalid webhook payload' });
  });

  it('returns 404 for GET request', async () => {
    const response = await SELF.fetch('http://localhost/api/v1/zulip/webhook');
    expect(response.status).toBe(404);
  });
});

import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { validateWebhookPayload } from '../services/zulip/validation.js';
import { constantTimeCompare } from '../utils/crypto.js';
import { handleMessage } from '../services/message-handler.js';

const zulipWebhook = new Hono<{ Bindings: Env }>();

zulipWebhook.post('/api/v1/zulip/webhook', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = validateWebhookPayload(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid webhook payload' }, 400);
  }

  if (!constantTimeCompare(parsed.data.token, c.env.ZULIP_WEBHOOK_TOKEN)) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  c.executionCtx.waitUntil(handleMessage(parsed.data, c.env));
  return c.json({ response_not_required: true });
});

export { zulipWebhook };

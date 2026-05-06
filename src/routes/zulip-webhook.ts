import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { validateWebhookPayload } from '../services/zulip/validation.js';
import { constantTimeCompare } from '../utils/crypto.js';
import { deriveThreadKey } from '../services/zulip/thread-key.js';
import { createRequestLogger } from '../utils/logger.js';

const zulipWebhook = new Hono<{ Bindings: Env }>();

zulipWebhook.post('/api/v1/zulip/webhook', async (c) => {
  const requestId = crypto.randomUUID();
  const logger = createRequestLogger(requestId);
  logger.log('webhook_received');

  const body = await c.req.json().catch(() => null);
  if (!body) {
    logger.warn('webhook_rejected', { reason: 'invalid_json' });
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  const parsed = validateWebhookPayload(body);
  if (!parsed.success) {
    logger.warn('webhook_rejected', { reason: 'invalid_payload', error: parsed.error });
    return c.json({ error: 'Invalid webhook payload' }, 400);
  }

  if (!constantTimeCompare(parsed.data.token, c.env.ZULIP_WEBHOOK_TOKEN)) {
    logger.warn('webhook_rejected', { reason: 'invalid_token' });
    return c.json({ error: 'Invalid token' }, 401);
  }

  const threadKey = deriveThreadKey(parsed.data.message, c.env.ZULIP_BOT_EMAIL);
  const doId = c.env.FRED_DO.idFromName(threadKey);
  const stub = c.env.FRED_DO.get(doId);

  // The DO returns 202 fast; orchestration runs in its background promise.
  // Awaiting here blocks Zulip's 200 only on the DO's ack (~ms), not on
  // orchestration. No ctx.waitUntil — orchestration is owned by the DO.
  const ack = await stub.fetch('https://fred-do/process', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': requestId,
    },
  });

  if (!ack.ok) {
    logger.error('fred_do_dispatch_failed', {
      thread_key: threadKey,
      do_status: ack.status,
    });
    return c.json({ error: 'Failed to dispatch to Fred' }, 502);
  }

  logger.log('fred_do_dispatched', {
    thread_key: threadKey,
    message_id: parsed.data.message.id,
    message_type: parsed.data.message.type,
  });
  return c.json({ response_not_required: true });
});

export { zulipWebhook };

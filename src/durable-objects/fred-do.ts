import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../types/env.js';
import { ZulipWebhookPayloadSchema } from '../services/zulip/types.js';
import { processFredMessage } from '../services/message-handler.js';
import { createRequestLogger } from '../utils/logger.js';

const PROCESS_PATH = '/process';

/**
 * Per-thread Durable Object that owns Fred orchestration. Routed by
 * deriveThreadKey() (channel:{stream_id}:{subject} or dm:{sorted_ids}), so
 * same-topic messages share an instance and serialize, and different-topic
 * messages run in parallel on separate instances.
 *
 * Orchestration runs inside the DO fetch handler, NOT in ctx.waitUntil. That
 * gives us the configured cpu_ms budget (5 minutes) and unlimited wall-clock
 * while the caller is connected — the 30-second post-response waitUntil
 * ceiling does not apply to DOs.
 */
export class FredDO extends DurableObject<Env> {
  /**
   * In-memory promise chain. Each new request appends to this so same-thread
   * messages serialize and the second message's history fetch sees the
   * first message's reply already posted to Zulip. Lost on instance
   * eviction, which is fine — Cloudflare's input gates serialize at the
   * runtime layer too, and worst case a follow-up's history is one reply
   * shy.
   */
  private processing: Promise<void> = Promise.resolve();

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== PROCESS_PATH) {
      return new Response('Not found', { status: 404 });
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const requestId = request.headers.get('X-Request-ID') ?? crypto.randomUUID();
    const logger = createRequestLogger(requestId);

    let body: unknown;
    try {
      body = await request.json();
    } catch (e) {
      logger.warn('fred_do_invalid_json', {
        error: e instanceof Error ? e.message : String(e),
      });
      return new Response('Invalid JSON body', { status: 400 });
    }

    const parsed = ZulipWebhookPayloadSchema.safeParse(body);
    if (!parsed.success) {
      logger.warn('fred_do_invalid_payload', { error: parsed.error.message });
      return new Response('Invalid payload', { status: 400 });
    }

    const payload = parsed.data;
    logger.log('fred_do_accepted', {
      message_id: payload.message.id,
      message_type: payload.message.type,
      sender_id: payload.message.sender_id,
    });

    this.processing = this.processing.then(() =>
      processFredMessage(payload, this.env, requestId).catch((e) => {
        // processFredMessage already routes user-facing errors through
        // sendErrorMessage. A throw escaping that path means the error
        // handler itself failed; log so the chain can recover. Hardening
        // this branch with a watchdog + backstop reply is #13.
        logger.error('fred_do_processing_unhandled', {
          error: e instanceof Error ? e.message : String(e),
          error_name: e instanceof Error ? e.name : 'Unknown',
        });
      })
    );

    return new Response(null, { status: 202 });
  }
}

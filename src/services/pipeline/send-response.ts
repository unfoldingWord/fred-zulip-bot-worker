import type { ZulipClient, SendMessageParams } from '../zulip/client.js';
import type { ZulipWebhookPayload } from '../zulip/types.js';
import type { RequestLogger } from '../../utils/logger.js';
import { otherParticipantIds } from '../zulip/recipients.js';
import { chunkForZulip } from '../zulip/chunk.js';

const SEND_RETRY_DELAY_MS = 250;
const FALLBACK_ERROR_TEXT =
  'Sorry, I encountered an error processing your request. Please try again.';

/**
 * Zulip's standard `max_message_length`. The server's real value is authoritative and an
 * operator can change it, so this is overridable via ZULIP_MAX_MESSAGE_LENGTH rather than
 * discovered at runtime: the only endpoint exposing it (`POST /register`) allocates a
 * server-side event queue as a side effect, which is a heavyweight, stateful way to read one
 * integer on the response path.
 */
export const DEFAULT_MAX_MESSAGE_LENGTH = 10000;

/** Where a message is going. These three always travel together. */
export interface SendTarget {
  client: ZulipClient;
  payload: ZulipWebhookPayload;
  botEmail: string;
}

function buildSendParams(
  payload: ZulipWebhookPayload,
  botEmail: string,
  content: string
): SendMessageParams {
  const msg = payload.message;
  if (msg.type === 'stream' && msg.stream_id !== undefined) {
    return { type: 'stream', to: msg.stream_id, topic: msg.subject, content };
  }
  return { type: 'direct', to: getDMRecipients(payload, botEmail), content };
}

function shouldRetry(status: number): boolean {
  return status === 0 || status >= 500;
}

async function postOnce(
  client: ZulipClient,
  params: SendMessageParams,
  logger: RequestLogger
): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await client.sendMessage(params);
    return { ok: res.ok, status: res.status };
  } catch (e) {
    logger.warn('response_post_threw', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { ok: false, status: 0 };
  }
}

/**
 * Post a message to Zulip with one retry on transient failure (5xx or thrown
 * network error). Throws if both attempts fail so the caller can decide whether
 * to attempt a fallback path; never silently drops.
 */
export async function sendResponse(
  target: SendTarget,
  response: string,
  logger: RequestLogger,
  maxMessageLength: number = DEFAULT_MAX_MESSAGE_LENGTH
): Promise<void> {
  const content = response.trim().length > 0 ? response : FALLBACK_ERROR_TEXT;
  if (content !== response) {
    logger.warn('response_empty_substituted', { original_length: response.length });
  }

  const parts = chunkForZulip(content, maxMessageLength);
  if (parts.length > 1) {
    logger.warn('response_chunked', {
      content_length: content.length,
      parts: parts.length,
      max_message_length: maxMessageLength,
    });
  }

  // Sequential, not parallel: Zulip orders by receipt, and a burst would let part 3 land
  // before part 2. A failed part throws, so the caller sees a partial delivery rather than
  // a silent gap.
  for (const [index, part] of parts.entries()) {
    await postPart({
      client: target.client,
      params: buildSendParams(target.payload, target.botEmail, part),
      logger,
      part: index + 1,
      parts: parts.length,
    });
  }
}

interface PartDelivery {
  client: ZulipClient;
  params: SendMessageParams;
  logger: RequestLogger;
  part: number;
  parts: number;
}

/** Post one message with a single retry on transient failure. Throws when both attempts fail. */
async function postPart(delivery: PartDelivery): Promise<void> {
  const { client, params, logger, part, parts } = delivery;
  const startMs = Date.now();

  const first = await postOnce(client, params, logger);
  if (first.ok) return logPosted(delivery, startMs, false);

  if (!shouldRetry(first.status)) {
    logger.error('response_post_error', {
      status: first.status,
      duration_ms: Date.now() - startMs,
      retried: false,
      part,
      parts,
    });
    throw new Error(`response_post_failed: status=${first.status}`);
  }

  logger.warn('response_post_retrying', { status: first.status, part, parts });
  await new Promise((r) => setTimeout(r, SEND_RETRY_DELAY_MS));
  const second = await postOnce(client, params, logger);
  if (second.ok) return logPosted(delivery, startMs, true);

  logger.error('response_post_error_fatal', {
    first_status: first.status,
    second_status: second.status,
    duration_ms: Date.now() - startMs,
    part,
    parts,
  });
  throw new Error(
    `response_post_failed_after_retry: first=${first.status} second=${second.status}`
  );
}

function logPosted(delivery: PartDelivery, startMs: number, retried: boolean): void {
  delivery.logger.log('response_posted', {
    content_length: delivery.params.content.length,
    duration_ms: Date.now() - startMs,
    part: delivery.part,
    parts: delivery.parts,
    ...(retried ? { retried: true } : {}),
  });
}

/**
 * Best-effort attempt to deliver an error message to the user. Wraps
 * sendResponse with an extra try/catch so a Zulip outage during the error
 * path cannot bubble out and become an unhandled rejection inside
 * waitUntil. Always logs a fatal event when delivery fails so the silent
 * case is at least visible in observability.
 */
export async function sendErrorMessage(
  client: ZulipClient,
  payload: ZulipWebhookPayload,
  botEmail: string,
  logger: RequestLogger,
  options?: { detail?: string; text?: string }
): Promise<{ delivered: boolean }> {
  const text =
    options?.text ??
    (options?.detail ? `${FALLBACK_ERROR_TEXT} (${options.detail})` : FALLBACK_ERROR_TEXT);
  try {
    await sendResponse({ client, payload, botEmail }, text, logger);
    return { delivered: true };
  } catch (e) {
    logger.error('error_message_send_failed_fatal', {
      error: e instanceof Error ? e.message : String(e),
    });
    return { delivered: false };
  }
}

function getDMRecipients(payload: ZulipWebhookPayload, botEmail: string): number[] {
  const others = otherParticipantIds(payload.message, botEmail);
  if (others.length > 0) return others;
  return [payload.message.sender_id];
}

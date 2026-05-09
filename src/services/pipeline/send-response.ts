import type { ZulipClient, SendMessageParams } from '../zulip/client.js';
import type { ZulipWebhookPayload } from '../zulip/types.js';
import type { RequestLogger } from '../../utils/logger.js';
import { otherParticipantIds } from '../zulip/recipients.js';

const SEND_RETRY_DELAY_MS = 250;
const FALLBACK_ERROR_TEXT =
  'Sorry, I encountered an error processing your request. Please try again.';

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
  client: ZulipClient,
  payload: ZulipWebhookPayload,
  botEmail: string,
  response: string,
  logger: RequestLogger
): Promise<void> {
  const startMs = Date.now();
  const content = response.trim().length > 0 ? response : FALLBACK_ERROR_TEXT;
  if (content !== response) {
    logger.warn('response_empty_substituted', { original_length: response.length });
  }
  const params = buildSendParams(payload, botEmail, content);

  const first = await postOnce(client, params, logger);
  if (first.ok) {
    logger.log('response_posted', {
      content_length: content.length,
      duration_ms: Date.now() - startMs,
    });
    return;
  }

  if (!shouldRetry(first.status)) {
    logger.error('response_post_error', {
      status: first.status,
      duration_ms: Date.now() - startMs,
      retried: false,
    });
    throw new Error(`response_post_failed: status=${first.status}`);
  }

  logger.warn('response_post_retrying', { status: first.status });
  await new Promise((r) => setTimeout(r, SEND_RETRY_DELAY_MS));
  const second = await postOnce(client, params, logger);
  if (second.ok) {
    logger.log('response_posted', {
      content_length: content.length,
      duration_ms: Date.now() - startMs,
      retried: true,
    });
    return;
  }

  logger.error('response_post_error_fatal', {
    first_status: first.status,
    second_status: second.status,
    duration_ms: Date.now() - startMs,
  });
  throw new Error(
    `response_post_failed_after_retry: first=${first.status} second=${second.status}`
  );
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
    await sendResponse(client, payload, botEmail, text, logger);
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

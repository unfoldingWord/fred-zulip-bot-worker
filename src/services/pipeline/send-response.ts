import type { ZulipClient } from '../zulip/client.js';
import type { ZulipWebhookPayload } from '../zulip/types.js';
import type { RequestLogger } from '../../utils/logger.js';
import { otherParticipantIds } from '../zulip/recipients.js';

export async function sendResponse(
  client: ZulipClient,
  payload: ZulipWebhookPayload,
  botEmail: string,
  response: string,
  logger: RequestLogger
): Promise<void> {
  const startMs = Date.now();
  const msg = payload.message;

  const params =
    msg.type === 'stream' && msg.stream_id !== undefined
      ? { type: 'stream' as const, to: msg.stream_id, topic: msg.subject, content: response }
      : { type: 'direct' as const, to: getDMRecipients(payload, botEmail), content: response };

  const res = await client.sendMessage(params);
  if (!res.ok) {
    logger.error('response_post_error', { status: res.status, duration_ms: Date.now() - startMs });
    return;
  }

  logger.log('response_posted', {
    content_length: response.length,
    duration_ms: Date.now() - startMs,
  });
}

export async function sendErrorMessage(
  client: ZulipClient,
  payload: ZulipWebhookPayload,
  botEmail: string,
  logger: RequestLogger
): Promise<void> {
  const errorMsg = 'Sorry, I encountered an error processing your request. Please try again.';
  await sendResponse(client, payload, botEmail, errorMsg, logger);
}

function getDMRecipients(payload: ZulipWebhookPayload, botEmail: string): number[] {
  const others = otherParticipantIds(payload.message, botEmail);
  if (others.length > 0) return others;
  return [payload.message.sender_id];
}

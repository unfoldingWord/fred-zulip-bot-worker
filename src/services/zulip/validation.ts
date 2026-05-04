import { ZulipWebhookPayloadSchema } from './types.js';
import type { ZulipWebhookPayload } from './types.js';

type ValidationResult =
  | { success: true; data: ZulipWebhookPayload }
  | { success: false; error: string };

export function validateWebhookPayload(body: unknown): ValidationResult {
  const result = ZulipWebhookPayloadSchema.safeParse(body);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error.message };
}

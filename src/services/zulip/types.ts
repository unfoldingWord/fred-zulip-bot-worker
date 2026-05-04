import { z } from 'zod';

const DisplayRecipientUser = z.object({
  id: z.number(),
  email: z.string(),
  full_name: z.string(),
});

export type DisplayRecipientUser = z.infer<typeof DisplayRecipientUser>;

const ZulipMessageSchema = z.object({
  id: z.number(),
  sender_id: z.number(),
  sender_email: z.string(),
  sender_full_name: z.string(),
  content: z.string(),
  subject: z.string(),
  stream_id: z.number().optional(),
  display_recipient: z.union([z.string(), z.array(DisplayRecipientUser)]),
  type: z.enum(['stream', 'private', 'direct']),
  timestamp: z.number(),
});

export type ZulipMessage = z.infer<typeof ZulipMessageSchema>;

export const ZulipWebhookPayloadSchema = z.object({
  bot_email: z.string(),
  bot_full_name: z.string(),
  data: z.string(),
  token: z.string(),
  trigger: z.string(),
  message: ZulipMessageSchema,
});

export type ZulipWebhookPayload = z.infer<typeof ZulipWebhookPayloadSchema>;

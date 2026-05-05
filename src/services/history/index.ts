import type { ZulipClient } from '../zulip/client.js';
import type { ZulipMessage } from '../zulip/types.js';
import type { ClaudeMessage } from './types.js';
import type { RequestLogger } from '../../utils/logger.js';
import { fetchHistory } from './fetcher.js';
import { formatAsClaudeMessages } from './formatter.js';

export async function getConversationContext(
  client: ZulipClient,
  message: ZulipMessage,
  botEmail: string,
  logger: RequestLogger
): Promise<ClaudeMessage[]> {
  const messages = await fetchHistory(client, message, botEmail, logger);
  return formatAsClaudeMessages(messages, botEmail);
}

export type { ClaudeMessage } from './types.js';

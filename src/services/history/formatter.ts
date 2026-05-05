import type { ZulipHistoryMessage, ClaudeMessage } from './types.js';

const BOT_MENTION_REGEX = /@\*\*[^*]+\*\*/g;

export function formatAsClaudeMessages(
  messages: ZulipHistoryMessage[],
  botEmail: string
): ClaudeMessage[] {
  return messages.map((msg) => {
    const isBot = msg.sender_email === botEmail;
    const content = isBot ? msg.content : formatUserMessage(msg);
    return { role: isBot ? 'assistant' : 'user', content } as ClaudeMessage;
  });
}

function formatUserMessage(msg: ZulipHistoryMessage): string {
  const stripped = msg.content.replace(BOT_MENTION_REGEX, '').trim();
  const name = msg.sender_full_name.slice(0, 64);
  return `[${name}]: ${stripped}`;
}

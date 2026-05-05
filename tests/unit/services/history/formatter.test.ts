import { describe, it, expect } from 'vitest';
import { formatAsClaudeMessages } from '../../../../src/services/history/formatter.js';
import type { ZulipHistoryMessage } from '../../../../src/services/history/types.js';

describe('formatAsClaudeMessages', () => {
  const botEmail = 'bot@example.com';

  it('maps bot messages to assistant role', () => {
    const messages: ZulipHistoryMessage[] = [
      {
        id: 1,
        sender_id: 10,
        sender_email: botEmail,
        sender_full_name: 'Fred',
        content: 'Hello!',
        timestamp: 1,
      },
    ];

    const result = formatAsClaudeMessages(messages, botEmail);
    expect(result[0].role).toBe('assistant');
    expect(result[0].content).toBe('Hello!');
  });

  it('maps human messages to user role with name prefix', () => {
    const messages: ZulipHistoryMessage[] = [
      {
        id: 1,
        sender_id: 5,
        sender_email: 'user@test.com',
        sender_full_name: 'Alice',
        content: 'question',
        timestamp: 1,
      },
    ];

    const result = formatAsClaudeMessages(messages, botEmail);
    expect(result[0].role).toBe('user');
    expect(result[0].content).toBe('[Alice]: question');
  });

  it('strips @-mentions from user messages', () => {
    const messages: ZulipHistoryMessage[] = [
      {
        id: 1,
        sender_id: 5,
        sender_email: 'user@test.com',
        sender_full_name: 'Bob',
        content: '@**Fred** what is this?',
        timestamp: 1,
      },
    ];

    const result = formatAsClaudeMessages(messages, botEmail);
    expect(result[0].content).toBe('[Bob]: what is this?');
  });

  it('strips multiple @-mentions', () => {
    const messages: ZulipHistoryMessage[] = [
      {
        id: 1,
        sender_id: 5,
        sender_email: 'user@test.com',
        sender_full_name: 'Eve',
        content: '@**Fred** @**Alice** hello',
        timestamp: 1,
      },
    ];

    const result = formatAsClaudeMessages(messages, botEmail);
    expect(result[0].content).toBe('[Eve]: hello');
  });

  it('handles multi-user conversations', () => {
    const messages: ZulipHistoryMessage[] = [
      {
        id: 1,
        sender_id: 5,
        sender_email: 'alice@test.com',
        sender_full_name: 'Alice',
        content: 'hi',
        timestamp: 1,
      },
      {
        id: 2,
        sender_id: 10,
        sender_email: botEmail,
        sender_full_name: 'Fred',
        content: 'hello',
        timestamp: 2,
      },
      {
        id: 3,
        sender_id: 7,
        sender_email: 'bob@test.com',
        sender_full_name: 'Bob',
        content: 'question',
        timestamp: 3,
      },
    ];

    const result = formatAsClaudeMessages(messages, botEmail);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ role: 'user', content: '[Alice]: hi' });
    expect(result[1]).toEqual({ role: 'assistant', content: 'hello' });
    expect(result[2]).toEqual({ role: 'user', content: '[Bob]: question' });
  });

  it('handles empty messages array', () => {
    const result = formatAsClaudeMessages([], botEmail);
    expect(result).toHaveLength(0);
  });
});

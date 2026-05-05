import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../../../src/services/claude/system-prompt.js';

describe('buildSystemPrompt', () => {
  it('includes identity section', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '| Tool | Desc |',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toContain('You are Fred');
    expect(prompt).toContain('unfoldingWord');
  });

  it('includes tool catalog markdown', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '| execute_sql | Run SQL |',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toContain('| execute_sql | Run SQL |');
    expect(prompt).toContain('execute_code');
  });

  it('includes query rules when provided', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: 'Always use snake_case table names.',
      conversationHistory: [],
    });

    expect(prompt).toContain('Always use snake_case table names.');
  });

  it('omits query rules section when empty', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).not.toContain('Fred Query Rules');
  });

  it('includes conversation context when provided', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [
        { role: 'user', content: 'How many projects?' },
        { role: 'assistant', content: 'There are 42 projects.' },
      ],
    });

    expect(prompt).toContain('Conversation Context');
    expect(prompt).toContain('How many projects?');
    expect(prompt).toContain('There are 42 projects.');
  });

  it('omits conversation section when history is empty', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).not.toContain('Conversation Context');
  });
});

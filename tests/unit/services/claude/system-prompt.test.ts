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

  it('describes the v2 identity (Claude Sonnet, Fred MCP, BT Servant)', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toContain('Fred Bot v2');
    expect(prompt).toMatch(/claude sonnet/i);
    expect(prompt).toContain('Fred MCP');
    expect(prompt).toContain('BT Servant');
  });

  it('includes tool catalog markdown', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '| execute_sql | Run SQL |',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toContain('| execute_sql | Run SQL |');
    expect(prompt).toContain('execute_sql');
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

  it('redirects off-topic questions to claude.ai or the Claude desktop app', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toContain('claude.ai');
    expect(prompt).toMatch(/claude desktop/i);
  });

  it('describes execute_code capability with restored "and execution" wording', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toContain('and execution');
    expect(prompt).toMatch(/code on the fly/i);
  });

  it('notes that MCP tools are callable inside execute_code', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toMatch(/inside execute_code/i);
  });

  it('includes Code Execution Guardrails with scoping rules', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toMatch(/Code Execution Guardrails/);
    expect(prompt).toMatch(/never loop over more than 10/i);
    expect(prompt).toMatch(/partial-results pattern/i);
  });

  it('mandates try/catch around every MCP call inside execute_code', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toMatch(/Error-Resilient Code/);
    expect(prompt).toMatch(/wrapped in its own try\/catch/i);
  });

  it('requires every turn to end in a user-facing text response', () => {
    const prompt = buildSystemPrompt({
      toolCatalogMarkdown: '',
      queryRules: '',
      conversationHistory: [],
    });

    expect(prompt).toMatch(/Closing the Turn/);
    expect(prompt).toMatch(/never terminate a turn on a silent tool result/i);
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

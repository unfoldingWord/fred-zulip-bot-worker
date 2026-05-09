import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../../../src/services/claude/system-prompt.js';
import { APP_VERSION } from '../../../../src/generated/version.js';

const baseParams = {
  toolCatalogMarkdown: '',
  queryRules: '',
  schema: '',
  conversationHistory: [] as { role: 'user' | 'assistant'; content: string }[],
};

describe('buildSystemPrompt', () => {
  it('includes identity section', () => {
    const prompt = buildSystemPrompt({ ...baseParams, toolCatalogMarkdown: '| Tool | Desc |' });

    expect(prompt).toContain('You are Fred');
    expect(prompt).toContain('unfoldingWord');
  });

  it('describes the v2 identity (Claude Sonnet, Fred MCP, BT Servant)', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).toContain('Fred Bot v2');
    expect(prompt).toMatch(/claude sonnet/i);
    expect(prompt).toContain('Fred MCP');
    expect(prompt).toContain('BT Servant');
  });

  it('includes tool catalog markdown', () => {
    const prompt = buildSystemPrompt({
      ...baseParams,
      toolCatalogMarkdown: '| execute_sql | Run SQL |',
    });

    expect(prompt).toContain('| execute_sql | Run SQL |');
    expect(prompt).toContain('execute_sql');
  });

  it('includes query rules when provided', () => {
    const prompt = buildSystemPrompt({
      ...baseParams,
      queryRules: 'Always use snake_case table names.',
    });

    expect(prompt).toContain('Always use snake_case table names.');
  });

  it('omits query rules section when empty', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).not.toContain('Fred Query Rules');
  });

  it('includes conversation context when provided', () => {
    const prompt = buildSystemPrompt({
      ...baseParams,
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
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).toContain('claude.ai');
    expect(prompt).toMatch(/claude desktop/i);
  });

  it('describes execute_code capability with restored "and execution" wording', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).toContain('and execution');
    expect(prompt).toMatch(/code on the fly/i);
  });

  it('notes that MCP tools are callable inside execute_code', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).toMatch(/inside execute_code/i);
  });

  it('includes Code Execution Guardrails with scoping rules', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).toMatch(/Code Execution Guardrails/);
    expect(prompt).toMatch(/never loop over more than 10/i);
    expect(prompt).toMatch(/partial-results pattern/i);
  });

  it('mandates try/catch around every MCP call inside execute_code', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).toMatch(/Error-Resilient Code/);
    expect(prompt).toMatch(/wrapped in its own try\/catch/i);
  });

  it('requires every turn to end in a user-facing text response', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).toMatch(/Closing the Turn/);
    expect(prompt).toMatch(/never terminate a turn on a silent tool result/i);
  });

  it('includes Beta Disclaimer section that points users to the FRED webapp', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).toContain('# Beta Disclaimer');
    expect(prompt).toMatch(/currently in beta/i);
    expect(prompt).toContain('FRED webapp');
    expect(prompt).toContain('⚠️ Beta reminder');
    expect(prompt).toMatch(/skip the disclaimer for purely conversational responses/i);
  });

  it('omits conversation section when history is empty', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).not.toContain('Conversation Context');
  });

  it('includes Database Schema section when schema is provided', () => {
    const prompt = buildSystemPrompt({
      ...baseParams,
      schema: 't:countries:cols=alpha_3_code:varchar(3)!:PK',
    });

    expect(prompt).toContain('# Database Schema (use this — do not call list_tables)');
    expect(prompt).toContain('alpha_3_code:varchar(3)!:PK');
  });

  it('omits Database Schema section when schema is empty', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).not.toContain('# Database Schema');
  });

  it('the "do not call list_tables" guidance only appears when schema is provided', () => {
    const withSchema = buildSystemPrompt({
      ...baseParams,
      schema: 't:countries:cols=alpha_3_code:varchar(3)!:PK',
    });
    const withoutSchema = buildSystemPrompt(baseParams);

    expect(withSchema).toMatch(/do not call list_tables/i);
    expect(withoutSchema).not.toMatch(/do not call list_tables/i);
  });

  it('surfaces the current APP_VERSION in the identity section', () => {
    const prompt = buildSystemPrompt(baseParams);

    expect(prompt).toContain(APP_VERSION);
    expect(prompt).toMatch(/Currently running version/);
    expect(prompt).toMatch(/answer with that string verbatim/i);
  });
});

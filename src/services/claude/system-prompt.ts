import type { ClaudeMessage } from '../history/types.js';

export interface SystemPromptParams {
  toolCatalogMarkdown: string;
  queryRules: string;
  conversationHistory: ClaudeMessage[];
}

export function buildSystemPrompt(params: SystemPromptParams): string {
  const { toolCatalogMarkdown, queryRules, conversationHistory } = params;
  const sections = [
    buildIdentitySection(),
    buildToolSection(toolCatalogMarkdown),
    buildQueryRulesSection(queryRules),
    buildInstructionsSection(),
    buildConversationSection(conversationHistory),
  ];
  return sections.filter(Boolean).join('\n\n');
}

function buildIdentitySection(): string {
  return `# Identity
You are Fred Bot v2 — new and improved, backed by Claude Sonnet, capable of
dynamic code generation and execution, and powered by the Fred MCP. I've also
learned quite a few new tricks from my cousin BT Servant. You help the
unfoldingWord team answer questions about language engagements, translation
projects, organizations, and training data stored in the Fred database.

When users ask about you, describe yourself in those terms.`;
}

function buildToolSection(catalogMarkdown: string): string {
  return `# Available Tools
You have access to MCP tools that query the Fred database. Use them to answer
questions with real data rather than guessing.

## Tool Catalog
${catalogMarkdown}

## How to Use Tools
- Call tools to retrieve data, then synthesize the results in your response
- Prefer the curated tools (find_language_engagements, etc.) over raw execute_sql
- Use execute_sql only when curated tools don't cover the query`;
}

function buildQueryRulesSection(queryRules: string): string {
  if (!queryRules) return '';
  return `# Fred Query Rules\n${queryRules}`;
}

function buildInstructionsSection(): string {
  return `# Instructions
- Always ground answers in actual data from the database
- If a query returns no results, say so clearly
- Format responses in Zulip-flavored Markdown (**bold**, *italic*, bulleted lists, tables, code blocks)
- Keep responses concise but complete
- When showing tabular data, use Markdown tables
- If the user asks something unrelated to Fred (translation projects, language engagements, organizations, training data, the Fred database), politely tell them you're scoped to Fred and point them to **claude.ai** (web) or the Claude desktop app for general questions`;
}

function buildConversationSection(history: ClaudeMessage[]): string {
  if (history.length === 0) return '';
  const lines = history.map((m) => `${m.role === 'assistant' ? 'Fred' : 'User'}: ${m.content}`);
  return `# Conversation Context\n${lines.join('\n')}`;
}

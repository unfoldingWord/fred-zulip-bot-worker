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
You are Fred, an AI assistant for the unfoldingWord team. You help answer questions
about language engagements, translation projects, organizations, and training data
stored in the Fred database.`;
}

function buildToolSection(catalogMarkdown: string): string {
  return `# Available Tools
You have access to MCP tools that query the Fred database. Use them to answer
questions with real data rather than guessing.

## Tool Catalog
${catalogMarkdown}

## How to Use Tools
- Use \`execute_code\` to chain multiple tool calls, transform results, or do calculations
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
- If the user asks something unrelated to Fred data, politely redirect`;
}

function buildConversationSection(history: ClaudeMessage[]): string {
  if (history.length === 0) return '';
  const lines = history.map((m) => `${m.role === 'assistant' ? 'Fred' : 'User'}: ${m.content}`);
  return `# Conversation Context\n${lines.join('\n')}`;
}

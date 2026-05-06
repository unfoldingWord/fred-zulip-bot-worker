import type { ToolCatalog } from '../mcp/types.js';
import type { ClaudeTool } from './types.js';

export function buildToolDefinitions(catalog: ToolCatalog): ClaudeTool[] {
  return [...catalog.tools.map((tool) => buildCatalogToolDefinition(tool)), buildExecuteCodeTool()];
}

function buildCatalogToolDefinition(tool: ToolCatalog['tools'][number]): ClaudeTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

export function buildExecuteCodeTool(): ClaudeTool {
  return {
    name: 'execute_code',
    description: `Execute JavaScript code in a sandboxed QuickJS environment.

SYNTAX: ES2020 JavaScript (not TypeScript). Your code runs in an async context, so you can use await directly.

PATTERN:
const rows = await execute_sql({ sql: "SELECT ..." });
__result__ = rows;

AVAILABLE: console.log/info/warn/error, JSON, all MCP tool functions listed in the catalog (callable as async functions).
NOT AVAILABLE: fetch, require, import, process, eval, Function constructor.

RESOURCE LIMITS:
- Maximum 10 MCP tool calls per execute_code invocation (hard limit — execution fails if exceeded).
- 30 second wall-clock timeout per execution.
- If you need more data, fetch a batch, present what you have, and offer to continue.

The code MUST set __result__ to return a value.`,
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description:
            'ES2020 JavaScript code. Use await for MCP tool calls. Must set __result__ to return a value.',
        },
      },
      required: ['code'],
    },
  };
}

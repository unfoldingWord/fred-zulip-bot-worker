import type { ToolCatalog } from '../mcp/types.js';
import type { ClaudeTool } from './types.js';

export function buildToolDefinitions(catalog: ToolCatalog): ClaudeTool[] {
  const mcpTools = catalog.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));

  return [...mcpTools, buildExecuteCodeTool()];
}

function buildExecuteCodeTool(): ClaudeTool {
  return {
    name: 'execute_code',
    description:
      'Execute JavaScript code in a sandboxed environment. MCP tools are available as async functions. Use __result__ to return a value.',
    input_schema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'JavaScript code to execute (ES2020, no imports/require)',
        },
      },
      required: ['code'],
    },
  };
}

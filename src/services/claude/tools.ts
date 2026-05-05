import type { ToolCatalog } from '../mcp/types.js';
import type { ClaudeTool } from './types.js';

export function buildToolDefinitions(catalog: ToolCatalog): ClaudeTool[] {
  return catalog.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  }));
}

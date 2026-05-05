import type { MCPServerManifest, ToolCatalog, CatalogTool } from './types.js';

export function buildToolCatalog(manifest: MCPServerManifest): ToolCatalog {
  const tools: CatalogTool[] = manifest.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    serverId: manifest.serverId,
    inputSchema: tool.inputSchema,
  }));

  return { tools };
}

export function generateToolCatalogMarkdown(catalog: ToolCatalog): string {
  if (catalog.tools.length === 0) return 'No tools available.';

  const lines = ['| Tool | Description |', '|------|-------------|'];
  for (const tool of catalog.tools) {
    const desc = tool.description.replace(/\|/g, '\\|').slice(0, 100);
    lines.push(`| ${tool.name} | ${desc} |`);
  }
  return lines.join('\n');
}

export function findTool(catalog: ToolCatalog, name: string): CatalogTool | undefined {
  return catalog.tools.find((t) => t.name === name);
}

export function getToolNames(catalog: ToolCatalog): string[] {
  return catalog.tools.map((t) => t.name);
}

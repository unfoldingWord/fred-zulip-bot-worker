import { describe, it, expect } from 'vitest';
import {
  buildToolCatalog,
  generateToolCatalogMarkdown,
  findTool,
  getToolNames,
} from '../../../../src/services/mcp/catalog.js';
import type { MCPServerManifest } from '../../../../src/services/mcp/types.js';

describe('buildToolCatalog', () => {
  const manifest: MCPServerManifest = {
    serverId: 'fred-mcp',
    tools: [
      { name: 'execute_sql', description: 'Run SQL queries', inputSchema: { type: 'object' } },
      { name: 'list_tables', description: 'List all tables', inputSchema: {} },
    ],
  };

  it('builds catalog from manifest', () => {
    const catalog = buildToolCatalog(manifest);

    expect(catalog.tools).toHaveLength(2);
    expect(catalog.tools[0].name).toBe('execute_sql');
    expect(catalog.tools[0].serverId).toBe('fred-mcp');
    expect(catalog.tools[1].name).toBe('list_tables');
  });

  it('handles empty manifest', () => {
    const catalog = buildToolCatalog({ serverId: 'empty', tools: [] });
    expect(catalog.tools).toHaveLength(0);
  });
});

describe('generateToolCatalogMarkdown', () => {
  it('generates markdown table from catalog', () => {
    const catalog = buildToolCatalog({
      serverId: 'fred-mcp',
      tools: [
        { name: 'execute_sql', description: 'Run SQL', inputSchema: {} },
        { name: 'list_tables', description: 'List tables', inputSchema: {} },
      ],
    });

    const md = generateToolCatalogMarkdown(catalog);
    expect(md).toContain('| Tool | Description |');
    expect(md).toContain('| execute_sql | Run SQL |');
    expect(md).toContain('| list_tables | List tables |');
  });

  it('returns fallback for empty catalog', () => {
    const md = generateToolCatalogMarkdown({ tools: [] });
    expect(md).toBe('No tools available.');
  });
});

describe('findTool', () => {
  const catalog = buildToolCatalog({
    serverId: 'fred-mcp',
    tools: [{ name: 'execute_sql', description: 'Run SQL', inputSchema: {} }],
  });

  it('finds tool by name', () => {
    const tool = findTool(catalog, 'execute_sql');
    expect(tool?.name).toBe('execute_sql');
  });

  it('returns undefined for unknown tool', () => {
    expect(findTool(catalog, 'nonexistent')).toBeUndefined();
  });
});

describe('getToolNames', () => {
  it('returns array of tool names', () => {
    const catalog = buildToolCatalog({
      serverId: 'fred-mcp',
      tools: [
        { name: 'a', description: '', inputSchema: {} },
        { name: 'b', description: '', inputSchema: {} },
      ],
    });
    expect(getToolNames(catalog)).toEqual(['a', 'b']);
  });
});

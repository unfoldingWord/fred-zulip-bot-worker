export interface MCPServerConfig {
  id: string;
  name: string;
  url: string;
  authToken: string;
}

export interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPServerManifest {
  serverId: string;
  tools: MCPToolDefinition[];
}

export interface CatalogTool {
  name: string;
  description: string;
  serverId: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolCatalog {
  tools: CatalogTool[];
}

export interface MCPToolCallResult {
  content: string;
  isError: boolean;
  meta?: { duration_ms: number; response_size: number };
}

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
  id: number;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

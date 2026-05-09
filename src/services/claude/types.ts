import type { RequestLogger } from '../../utils/logger.js';
import type { OrchestrationConfig } from '../../utils/config.js';
import type { MCPServerConfig, ToolCatalog } from '../mcp/types.js';
import type { HealthTracker } from '../mcp/health.js';
import type { ClaudeMessage } from '../history/types.js';

export interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  content: ContentBlock[];
  model: string;
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: { input_tokens: number; output_tokens: number };
}

export type ContentBlock = TextBlock | ToolUseBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ClaudeTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface OrchestrationContext {
  config: OrchestrationConfig;
  mcpConfig: MCPServerConfig;
  catalog: ToolCatalog;
  healthTracker: HealthTracker;
  logger: RequestLogger;
  requestId: string;
  mcpCallCount: number;
  iterations: number;
  abortSignal: AbortSignal;
}

export interface OrchestrationOptions {
  userMessage: string;
  conversationHistory: ClaudeMessage[];
  systemPrompt: string;
  tools: ClaudeTool[];
  context: OrchestrationContext;
}

export interface OrchestrationResult {
  response: string;
  iterations: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export type MessageParam =
  | { role: 'user'; content: string | ContentBlock[] }
  | { role: 'assistant'; content: ContentBlock[] };

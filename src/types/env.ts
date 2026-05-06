export interface Env {
  // Vars (set in wrangler.toml)
  ENVIRONMENT: string;
  MAX_ORCHESTRATION_ITERATIONS?: string;
  CODE_EXEC_TIMEOUT_MS?: string;
  CODE_EXEC_MEMORY_LIMIT_BYTES?: string;
  CODE_EXEC_STACK_SIZE_BYTES?: string;
  MAX_MCP_CALLS_PER_EXECUTION?: string;
  MAX_MCP_CALLS_PER_REQUEST?: string;
  CLAUDE_MODEL?: string;
  CLAUDE_MAX_TOKENS?: string;
  FRED_MCP_URL?: string;

  // Secrets (set via wrangler secret put)
  ZULIP_BOT_EMAIL: string;
  ZULIP_BOT_API_KEY: string;
  ZULIP_WEBHOOK_TOKEN: string;
  ZULIP_SITE: string;
  ANTHROPIC_API_KEY: string;
  FRED_MCP_TOKEN: string;

  // KV Namespaces
  CONVERSATION_CACHE: KVNamespace;

  // Durable Objects
  FRED_DO: DurableObjectNamespace;
}

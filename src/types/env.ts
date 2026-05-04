export interface Env {
  // Vars (set in wrangler.toml)
  ENVIRONMENT: string;

  // Secrets (set via wrangler secret put)
  ZULIP_BOT_EMAIL: string;
  ZULIP_BOT_API_KEY: string;
  ZULIP_WEBHOOK_TOKEN: string;
  ZULIP_SITE: string;
  ANTHROPIC_API_KEY: string;
  FRED_MCP_TOKEN: string;
  ENGINE_API_KEY: string;

  // KV Namespaces
  CONVERSATION_CACHE: KVNamespace;
}

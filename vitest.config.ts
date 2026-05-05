import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.test.toml' },
      miniflare: {
        bindings: {
          ENVIRONMENT: 'test',
          ZULIP_WEBHOOK_TOKEN: 'test-webhook-token',
          ZULIP_BOT_EMAIL: 'bot@example.com',
          ZULIP_BOT_API_KEY: 'test-api-key',
          ZULIP_SITE: 'https://chat.example.com',
          ANTHROPIC_API_KEY: 'test-anthropic-key',
          FRED_MCP_TOKEN: 'test-mcp-token',
          ENGINE_API_KEY: 'test-engine-key',
        },
        kvNamespaces: ['CONVERSATION_CACHE'],
        outboundService: () => new Response(JSON.stringify({ result: 'success' }), { status: 200 }),
      },
    }),
  ],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
  },
});

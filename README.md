# fred-zulip-bot-worker

fred-zulip-bot-worker

## Deploys

Two environments, one codebase:

- **Test** (`fred-zulip-bot-test`) — auto-deploys on every push to `main` via `.github/workflows/deploy-test.yml`. Use this to validate changes against the test Zulip bot before promoting to prod.
- **Production** (`fred-zulip-bot`) — manual `workflow_dispatch` only, via `.github/workflows/deploy-prod.yml` (Actions tab → "Deploy Production" → Run workflow).

The two environments share the codebase but have separate KV namespaces, Durable Object storage, secrets, and Zulip bot credentials. See `[env.test]` in `wrangler.toml`.

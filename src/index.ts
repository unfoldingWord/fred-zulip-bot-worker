import { Hono } from 'hono';
import type { Env } from './types/env.js';
import { health } from './routes/health.js';
import { zulipWebhook } from './routes/zulip-webhook.js';

const app = new Hono<{ Bindings: Env }>();

app.route('', health);
app.route('', zulipWebhook);

export default app;

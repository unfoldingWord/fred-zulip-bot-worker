import { Hono } from 'hono';
import type { Env } from '../types/env.js';
import { APP_VERSION } from '../generated/version.js';

const health = new Hono<{ Bindings: Env }>();

health.get('/health', (c) => c.json({ status: 'healthy', version: APP_VERSION }));

export { health };

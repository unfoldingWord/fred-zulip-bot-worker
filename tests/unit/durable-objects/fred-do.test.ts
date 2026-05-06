import { describe, it, expect } from 'vitest';
import { env, runInDurableObject } from 'cloudflare:test';
import type { FredDO } from '../../../src/durable-objects/fred-do.js';

function buildValidPayload(overrides: Record<string, unknown> = {}) {
  return {
    bot_email: 'fred-bot@chat.example.com',
    bot_full_name: 'Fred',
    data: '@**Fred** hello',
    token: 'test-webhook-token',
    trigger: 'mention',
    message: {
      id: 42,
      sender_id: 7,
      sender_email: 'user@example.com',
      sender_full_name: 'Test User',
      content: 'hello',
      subject: 'general',
      stream_id: 1,
      display_recipient: 'engineering',
      type: 'stream',
      timestamp: 1700000000,
    },
    ...overrides,
  };
}

function getStub(name: string) {
  const id = env.FRED_DO.idFromName(name);
  return env.FRED_DO.get(id);
}

// Awaits the DO's in-memory processing chain so background work either
// settles or fails before the test exits. Without this, vitest-pool-workers
// emits teardown noise about cross-DO I/O on the still-pending fetches
// inside processFredMessage.
async function flushProcessing(stub: DurableObjectStub): Promise<void> {
  await runInDurableObject(stub, async (instance) => {
    await (instance as FredDO & { processing: Promise<void> }).processing;
  });
}

describe('FredDO', () => {
  it('returns 202 for a valid POST /process', async () => {
    const stub = getStub('test-202');
    const res = await stub.fetch('https://fred-do/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildValidPayload()),
    });
    expect(res.status).toBe(202);
    await flushProcessing(stub);
  });

  it('returns 404 for unknown paths', async () => {
    const stub = getStub('test-404');
    const res = await stub.fetch('https://fred-do/other', {
      method: 'POST',
      body: '{}',
    });
    expect(res.status).toBe(404);
  });

  it('returns 405 for non-POST on /process', async () => {
    const stub = getStub('test-405');
    const res = await stub.fetch('https://fred-do/process', { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('returns 400 for invalid JSON body', async () => {
    const stub = getStub('test-400-json');
    const res = await stub.fetch('https://fred-do/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for payload that fails schema validation', async () => {
    const stub = getStub('test-400-schema');
    const res = await stub.fetch('https://fred-do/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'x' }),
    });
    expect(res.status).toBe(400);
  });

  it('two back-to-back valid requests both ack 202', async () => {
    const stub = getStub('test-serialize');
    const send = () =>
      stub.fetch('https://fred-do/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildValidPayload()),
      });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status).toBe(202);
    expect(b.status).toBe(202);
    await flushProcessing(stub);
  });
});

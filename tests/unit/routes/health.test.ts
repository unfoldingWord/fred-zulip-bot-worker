import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';
import { APP_VERSION } from '../../../src/generated/version.js';

describe('GET /health', () => {
  it('returns 200 with status and version', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({
      status: 'healthy',
      version: APP_VERSION,
    });
  });
});

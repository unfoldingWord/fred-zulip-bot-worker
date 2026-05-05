import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('GET /health', () => {
  it('returns 200 with status and version', async () => {
    const response = await SELF.fetch('http://localhost/health');
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({
      status: 'healthy',
      version: '0.1.0',
    });
  });
});

const SENSITIVE_KEYS = new Set([
  'token',
  'secret',
  'password',
  'auth',
  'api_key',
  'apiKey',
  'authorization',
  'credential',
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return [...SENSITIVE_KEYS].some((s) => lower.includes(s));
}

export function summarizeArgs(args: unknown): unknown {
  if (args === null || args === undefined) return args;
  if (typeof args === 'string') return `string(${args.length})`;
  if (typeof args === 'number' || typeof args === 'boolean') return args;
  if (Array.isArray(args)) return `array(${args.length})`;
  if (typeof args === 'object') {
    const summary: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      summary[key] = typeof value === 'string' ? `string(${value.length})` : typeof value;
    }
    return summary;
  }
  return typeof args;
}

export function redactSensitiveKeys(args: unknown): unknown {
  if (args === null || args === undefined) return args;
  if (typeof args !== 'object') return args;
  if (Array.isArray(args)) return args.map(redactSensitiveKeys);
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (isSensitiveKey(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 700) {
      redacted[key] = value.slice(0, 500) + '...' + value.slice(-200);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

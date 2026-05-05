import { describe, it, expect } from 'vitest';
import { summarizeArgs, redactSensitiveKeys } from '../../../src/utils/log-redaction.js';

describe('summarizeArgs', () => {
  it('returns null/undefined as-is', () => {
    expect(summarizeArgs(null)).toBeNull();
    expect(summarizeArgs(undefined)).toBeUndefined();
  });

  it('summarizes strings as string(length)', () => {
    expect(summarizeArgs('hello')).toBe('string(5)');
  });

  it('passes numbers and booleans through', () => {
    expect(summarizeArgs(42)).toBe(42);
    expect(summarizeArgs(true)).toBe(true);
  });

  it('summarizes arrays as array(length)', () => {
    expect(summarizeArgs([1, 2, 3])).toBe('array(3)');
  });

  it('summarizes object values by type and length', () => {
    const result = summarizeArgs({ code: 'abc', count: 5 });
    expect(result).toEqual({ code: 'string(3)', count: 'number' });
  });
});

describe('redactSensitiveKeys', () => {
  it('returns primitives unchanged', () => {
    expect(redactSensitiveKeys(null)).toBeNull();
    expect(redactSensitiveKeys(42)).toBe(42);
    expect(redactSensitiveKeys('hello')).toBe('hello');
  });

  it('redacts sensitive keys', () => {
    const result = redactSensitiveKeys({
      token: 'secret-value',
      api_key: 'key-123',
      name: 'visible',
    });
    expect(result).toEqual({
      token: '[REDACTED]',
      api_key: '[REDACTED]',
      name: 'visible',
    });
  });

  it('truncates long strings (>700 chars)', () => {
    const longValue = 'x'.repeat(800);
    const result = redactSensitiveKeys({ data: longValue }) as Record<string, string>;
    expect(result.data.length).toBeLessThan(800);
    expect(result.data).toContain('...');
  });

  it('handles arrays recursively', () => {
    const result = redactSensitiveKeys([{ token: 'secret' }]);
    expect(result).toEqual([{ token: '[REDACTED]' }]);
  });
});

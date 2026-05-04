import { describe, it, expect } from 'vitest';
import { constantTimeCompare } from '../../../src/utils/crypto.js';

describe('constantTimeCompare', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeCompare('hello', 'hello')).toBe(true);
  });

  it('returns false for different strings of same length', () => {
    expect(constantTimeCompare('hello', 'world')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    expect(constantTimeCompare('short', 'much-longer-string')).toBe(false);
  });

  it('returns true for empty strings', () => {
    expect(constantTimeCompare('', '')).toBe(true);
  });

  it('returns false when one string is empty', () => {
    expect(constantTimeCompare('', 'nonempty')).toBe(false);
  });
});

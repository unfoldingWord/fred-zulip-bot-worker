import { describe, it, expect } from 'vitest';
import { chunkForZulip } from '../../../../src/services/zulip/chunk.js';

const LIMIT = 10000;

describe('chunkForZulip', () => {
  it('returns the content untouched when it already fits', () => {
    const content = 'A short answer.';
    expect(chunkForZulip(content, LIMIT)).toEqual([content]);
  });

  it('returns a single part for content exactly at the limit', () => {
    const content = 'x'.repeat(LIMIT);
    expect(chunkForZulip(content, LIMIT)).toEqual([content]);
  });

  // Zulip enforces max_message_length; anything past it does not reach the reader intact.
  it('splits an over-limit response into parts that each fit', () => {
    const line = 'Row of a long report table.';
    const content = Array.from({ length: 800 }, (_, i) => `${i}. ${line}`).join('\n');
    expect(content.length).toBeGreaterThan(LIMIT);

    const parts = chunkForZulip(content, LIMIT);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(LIMIT);
    }
  });

  it('preserves every line of the original content across the parts', () => {
    const content = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const parts = chunkForZulip(content, 2000);

    const rejoined = parts
      .map((p) => p.replace(/^\*\(part \d+\/\d+\)\*\n\n/, ''))
      .join('\n')
      .split('\n');

    for (let i = 0; i < 500; i++) {
      expect(rejoined).toContain(`line ${i}`);
    }
  });

  it('labels each part so the reader knows more is coming', () => {
    const content = Array.from({ length: 500 }, (_, i) => `line ${i}`).join('\n');
    const parts = chunkForZulip(content, 2000);

    expect(parts[0]).toMatch(/^\*\(part 1\/\d+\)\*/);
    expect(parts[parts.length - 1].startsWith(`*(part ${parts.length}/${parts.length})*`)).toBe(
      true
    );
  });

  // A chunk boundary landing inside ``` would render the rest of the report as code.
  it('closes and reopens a fenced code block that spans a boundary', () => {
    const body = Array.from({ length: 300 }, (_, i) => `SELECT ${i};`).join('\n');
    const content = `Here is the query:\n\n\`\`\`sql\n${body}\n\`\`\`\n`;

    const parts = chunkForZulip(content, 1200);
    expect(parts.length).toBeGreaterThan(1);

    for (const part of parts) {
      const fences = (part.match(/```/g) ?? []).length;
      expect(fences % 2).toBe(0);
    }
    // The language tag survives into the continuation parts.
    expect(parts[1]).toContain('```sql');
  });

  it('hard-splits a single line longer than the limit', () => {
    const content = 'y'.repeat(5000);
    const parts = chunkForZulip(content, 1000);

    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(1000);
    }
  });

  it('treats a non-positive limit as no limit rather than looping', () => {
    const content = 'anything';
    expect(chunkForZulip(content, 0)).toEqual([content]);
  });
});

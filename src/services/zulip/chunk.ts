/**
 * Split a response into messages that fit Zulip's per-message content limit.
 *
 * Zulip's send-message contract requires clients to honor the server's
 * `max_message_length` (standard default 10,000 characters); content beyond it does not
 * reach the reader intact. Raising the model's output ceiling without splitting here would
 * just move truncation from the model to the transport — the same silently-cut-off report,
 * one layer down.
 *
 * Splitting prefers line boundaries and never leaves a fenced code block hanging: a chunk
 * that ends mid-fence is closed, and the next chunk reopens with the same fence (language
 * tag included) so each message renders on its own.
 */

const FENCE = '```';

/** Room reserved for the `*(part n/m)*` header prepended to multi-part responses. */
const PART_HEADER_RESERVE = 24;

/** Below this, fence bookkeeping costs more than it can fit; fall back to a plain hard split. */
const MIN_FENCE_AWARE_BUDGET = 64;

/**
 * Split `content` into parts that each fit within `limit` characters.
 * Returns a single-element array when the content already fits, so the common
 * case posts exactly one message and is byte-identical to the input.
 */
export function chunkForZulip(content: string, limit: number): string[] {
  if (limit <= 0 || content.length <= limit) return [content];

  const budget = Math.max(1, limit - PART_HEADER_RESERVE);
  const parts =
    budget < MIN_FENCE_AWARE_BUDGET ? hardSplit(content, budget) : splitLines(content, budget);

  if (parts.length <= 1) return parts;
  return parts.map((part, i) => `*(part ${i + 1}/${parts.length})*\n\n${part}`);
}

/**
 * Split on line boundaries, keeping fenced code blocks balanced across parts.
 *
 * Sizing is done against the chunk as it would actually be emitted — including the fence
 * reopened at the start of a continuation chunk and the fence appended when closing one.
 * Measuring the rendered form rather than tracking a running counter is what keeps the
 * limit honest: a long line inside a code block otherwise overshoots by exactly the fence
 * overhead, which is invisible to a naive character count.
 */
function splitLines(content: string, budget: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  // The opening fence line (e.g. '```sql') while inside a code block, else null.
  let openFence: string | null = null;

  /** Length of `lines` as an emitted chunk, counting the closing fence when one is owed. */
  const rendered = (lines: string[]): number => {
    const body = lines.join('\n');
    return openFence ? body.length + 1 + FENCE.length : body.length;
  };

  /** True when the chunk holds nothing but a reopened fence — flushing it would emit noise. */
  const isEmpty = (): boolean =>
    current.length === 0 || (current.length === 1 && current[0] === openFence);

  const flush = (reopen: boolean): void => {
    if (current.length === 0) return;
    chunks.push(openFence ? `${current.join('\n')}\n${FENCE}` : current.join('\n'));
    current = reopen && openFence ? [openFence] : [];
  };

  const push = (piece: string): void => {
    current.push(piece);
    if (piece.startsWith(FENCE)) openFence = openFence ? null : piece;
  };

  const appendLine = (line: string): void => {
    let remaining = line;
    for (;;) {
      if (rendered([...current, remaining]) <= budget) {
        push(remaining);
        return;
      }
      // Doesn't fit here — try a fresh chunk before resorting to breaking the line.
      if (!isEmpty()) {
        flush(true);
        if (rendered([...current, remaining]) <= budget) {
          push(remaining);
          return;
        }
      }
      // Still too long for a whole chunk: take exactly what the remaining room allows.
      const room = budget - rendered([...current, '']);
      if (room <= 0) {
        // Pathological (a fence line alone near the budget); emit rather than spin.
        push(remaining);
        return;
      }
      push(remaining.slice(0, room));
      remaining = remaining.slice(room);
      flush(true);
    }
  };

  for (const line of content.split('\n')) appendLine(line);
  flush(false);

  return chunks.length > 0 ? chunks : [content];
}

/** Break a string into fixed-size pieces. Used for content with no usable line boundary. */
function hardSplit(text: string, budget: number): string[] {
  if (text.length <= budget) return [text];
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += budget) {
    pieces.push(text.slice(i, i + budget));
  }
  return pieces;
}

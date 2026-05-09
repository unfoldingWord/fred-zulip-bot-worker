/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only if both strings are equal in value and length.
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  const encoder = new TextEncoder();
  const bufA = encoder.encode(a);
  const bufB = encoder.encode(b);

  let mismatch = 0;
  for (let i = 0; i < bufA.length; i++) {
    // eslint-disable-next-line security/detect-object-injection -- i is a bounded loop counter into Uint8Array
    mismatch |= (bufA[i] as number) ^ (bufB[i] as number);
  }

  return mismatch === 0;
}

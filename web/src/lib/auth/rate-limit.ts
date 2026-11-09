/**
 * A small in-memory sliding-window limiter for the password-reset form (Self-Auth leaves that to the app).
 * It counts requests, never anything about the account, so a limited reply tells nothing about whether an
 * address exists. State is per server process: best effort on serverless, which is the point of a floor, not a wall.
 */
export function createLimiter(max: number, windowMs: number, maxKeys = 5000) {
  const hits = new Map<string, number[]>();
  return {
    /** Records an attempt for `key`; false when it is over the limit (the attempt is not counted then). */
    allow(key: string, now = Date.now()): boolean {
      const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (recent.length >= max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now);
      hits.delete(key);
      hits.set(key, recent);
      // Bound memory: drop the oldest-touched keys.
      while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
      return true;
    },
  };
}

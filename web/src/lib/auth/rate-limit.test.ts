import { describe, it, expect } from 'vitest';
import { createLimiter } from './rate-limit';

describe('createLimiter', () => {
  it('allows up to max in the window, then refuses until the window passes', () => {
    const l = createLimiter(2, 1000);
    expect(l.allow('k', 0)).toBe(true);
    expect(l.allow('k', 10)).toBe(true);
    expect(l.allow('k', 20)).toBe(false);
    expect(l.allow('k', 1005)).toBe(true);
  });
  it('keeps keys apart and bounds memory', () => {
    const l = createLimiter(1, 1000, 2);
    expect(l.allow('a', 0)).toBe(true);
    expect(l.allow('b', 0)).toBe(true);
    expect(l.allow('c', 0)).toBe(true);
    expect(l.allow('a', 1)).toBe(true); // 'a' was dropped to stay within 2 keys
    expect(l.allow('c', 1)).toBe(false);
  });
});

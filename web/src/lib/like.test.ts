import { describe, it, expect } from 'vitest';
import { escapeLike } from './like';

describe('escapeLike', () => {
  it('matches the text literally in an ilike pattern', () => {
    expect(escapeLike(String.raw`P_1%\x`)).toBe(String.raw`P\_1\%\\x`);
    expect(escapeLike('p00012')).toBe('p00012');
  });
});

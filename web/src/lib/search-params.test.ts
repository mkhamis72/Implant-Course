import { describe, it, expect } from 'vitest';
import { firstParam } from './search-params';

describe('firstParam', () => {
  it('returns a single string for repeated, missing or normal parameters', () => {
    expect(firstParam(['a', 'b'])).toBe('a');
    expect(firstParam(undefined)).toBe('');
    expect(firstParam('x')).toBe('x');
    expect(firstParam(undefined, 'open')).toBe('open');
  });
});

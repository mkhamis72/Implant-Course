import { describe, it, expect } from 'vitest';
import { normaliseHost } from './host';

describe('normaliseHost', () => {
  it.each([
    ['academy.example.com', 'academy.example.com'],
    ['Academy.Example.COM', 'academy.example.com'],
    ['academy.example.com:443', 'academy.example.com'],
    ['academy.example.com.', 'academy.example.com'],
    ['localhost:3000', 'localhost'],
    ['tenant2.localhost:3000', 'tenant2.localhost'],
  ])('%s → %s', (raw, expected) => {
    expect(normaliseHost(raw)).toBe(expected);
  });

  it.each([null, undefined, '', '   ', 'evil.com/x', 'a b.com', '203.0.113.5', '[::1]:3000', '-bad.com', 'x'.repeat(254)])(
    'rejects %s',
    (raw) => {
      expect(normaliseHost(raw as string)).toBeNull();
    },
  );
});

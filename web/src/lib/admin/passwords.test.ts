import { describe, it, expect } from 'vitest';
import { temporaryPassword } from './passwords';

describe('temporaryPassword', () => {
  it('is long, URL-safe and different every time', () => {
    const a = temporaryPassword();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(temporaryPassword()).not.toBe(a);
  });
});

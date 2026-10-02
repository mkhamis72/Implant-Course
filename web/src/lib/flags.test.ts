import { describe, it, expect } from 'vitest';
import { emailEnabled, pilotMode } from './flags';

describe('flags', () => {
  it('email is on unless EMAIL_ENABLED is exactly "false"', () => {
    expect(emailEnabled({})).toBe(true);
    expect(emailEnabled({ EMAIL_ENABLED: 'true' })).toBe(true);
    expect(emailEnabled({ EMAIL_ENABLED: 'false' })).toBe(false);
  });
  it('pilot mode is on only when NEXT_PUBLIC_PILOT is exactly "1"', () => {
    expect(pilotMode({})).toBe(false);
    expect(pilotMode({ NEXT_PUBLIC_PILOT: '0' })).toBe(false);
    expect(pilotMode({ NEXT_PUBLIC_PILOT: '1' })).toBe(true);
  });
});

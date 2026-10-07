import { describe, it, expect } from 'vitest';
import { consoleMfaStep } from './mfa-step';

describe('consoleMfaStep', () => {
  it('requires setting up an authenticator when none is verified', () => {
    expect(consoleMfaStep(undefined, 'aal1')).toBe('setup');
    expect(consoleMfaStep([{ status: 'unverified' }], 'aal1')).toBe('setup');
  });
  it('requires the code when a factor exists but the session is aal1', () => {
    expect(consoleMfaStep([{ status: 'verified' }], 'aal1')).toBe('verify');
    expect(consoleMfaStep([{ status: 'verified' }], null)).toBe('verify');
  });
  it('lets an aal2 session with a verified factor in', () => {
    expect(consoleMfaStep([{ status: 'verified' }], 'aal2')).toBe('ok');
  });
});

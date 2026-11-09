import { describe, it, expect } from 'vitest';
import { consoleMfaStep } from './mfa-step';

describe('consoleMfaStep', () => {
  it('requires setting up an authenticator when there is none', () => {
    expect(consoleMfaStep(false, 'aal1')).toBe('setup');
  });
  it('requires the code when an authenticator exists but the session is aal1', () => {
    expect(consoleMfaStep(true, 'aal1')).toBe('verify');
  });
  it('lets an aal2 session with an authenticator in', () => {
    expect(consoleMfaStep(true, 'aal2')).toBe('ok');
  });
});

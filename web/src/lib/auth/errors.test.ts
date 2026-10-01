import { describe, it, expect } from 'vitest';
import { mapAuthError, GENERIC_AUTH_ERROR } from './errors';

describe('mapAuthError', () => {
  it.each([
    ['invalid_credentials', 'Incorrect email or password.'],
    ['email_not_confirmed', 'Please verify your email first — check your inbox for the verification link.'],
    ['user_banned', 'This account has been deactivated. Contact an admin.'],
    ['otp_expired', 'This link is invalid or has expired. Ask an admin to send a new invite.'],
    ['mfa_verification_failed', 'That code is not correct. Check your authenticator app and try again.'],
    ['email_exists', 'A user with this email already exists.'],
    ['missing_token', 'This link is incomplete. Open the link from your email again.'],
  ])('maps %s', (code, message) => {
    expect(mapAuthError({ code, message: 'raw' })).toBe(message);
    expect(mapAuthError(code)).toBe(message);
  });

  it('maps the legacy "already been registered" 422 to email_exists', () => {
    expect(
      mapAuthError({ status: 422, message: 'A user with this email address has already been registered' }),
    ).toBe('A user with this email already exists.');
  });

  it('falls back to a generic message and never leaks raw text', () => {
    expect(mapAuthError({ code: 'weird', message: 'stack trace...' })).toBe(GENERIC_AUTH_ERROR);
    expect(mapAuthError(null)).toBe(GENERIC_AUTH_ERROR);
  });
});

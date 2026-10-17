import { describe, it, expect } from 'vitest';
import { FORGOT_SENT, FORGOT_TOO_MANY, afterMfaPath, forgotReply, resetCookieOptions } from './password-reset';

describe('forgotReply', () => {
  it('gives the same reply whether or not the address has an account', () => {
    expect(forgotReply(null)).toBe(FORGOT_SENT);
    expect(forgotReply({ code: 'user_not_found', message: 'User not found' })).toBe(FORGOT_SENT);
    expect(forgotReply({ code: 'unexpected_failure', message: 'Error sending recovery email' })).toBe(FORGOT_SENT);
  });
  it('says so when Supabase rate-limits the request', () => {
    expect(forgotReply({ code: 'over_email_send_rate_limit', message: 'x' })).toBe(FORGOT_TOO_MANY);
    expect(forgotReply({ code: 'over_request_rate_limit', message: 'x' })).toBe(FORGOT_TOO_MANY);
    expect(forgotReply({ status: 429, message: 'For security purposes, you can only request this after 42 seconds.' })).toBe(FORGOT_TOO_MANY);
  });
});

describe('afterMfaPath', () => {
  it('continues to the new-password page while a reset is pending', () => {
    expect(afterMfaPath('1')).toBe('/account/set-password');
  });
  it('goes home otherwise', () => {
    expect(afterMfaPath(undefined)).toBe('/');
    expect(afterMfaPath('')).toBe('/');
  });
});

describe('resetCookieOptions', () => {
  it('is httpOnly and lasts 15 minutes', () => {
    expect(resetCookieOptions).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 900 });
  });
});

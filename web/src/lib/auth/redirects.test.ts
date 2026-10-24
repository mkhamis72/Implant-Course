import { describe, it, expect } from 'vitest';
import { classifyPath, decideRedirect, verifiedAal } from './redirects';

const aal1 = { current: 'aal1', next: 'aal1' };
const needsMfa = { current: 'aal1', next: 'aal2' };
const aal2 = { current: 'aal2', next: 'aal2' };

describe('classifyPath', () => {
  it.each([
    ['/login', 'public'],
    ['/brand/logo', 'public'],
    ['/auth/confirm', 'public'],
    ['/auth/error', 'public'],
    ['/login/forgot', 'public'],
    ['/login/mfa', 'mfa'],
    ['/', 'protected'],
    ['/admin/users', 'protected'],
    ['/account/set-password', 'protected'],
    ['/deactivated', 'protected'],
    ['/loginx', 'protected'],
  ])('%s is %s', (path, kind) => {
    expect(classifyPath(path)).toBe(kind);
  });
});

describe('decideRedirect', () => {
  it('sends anonymous users on protected pages to /login', () => {
    expect(decideRedirect({ path: '/', hasUser: false, aal: null })).toBe('/login');
  });
  it('sends anonymous users on /login/mfa to /login', () => {
    expect(decideRedirect({ path: '/login/mfa', hasUser: false, aal: null })).toBe('/login');
  });
  it('lets anonymous users see public pages', () => {
    expect(decideRedirect({ path: '/login', hasUser: false, aal: null })).toBeNull();
    expect(decideRedirect({ path: '/auth/confirm', hasUser: false, aal: null })).toBeNull();
  });
  it('lets signed-in users without 2FA through', () => {
    expect(decideRedirect({ path: '/admin/users', hasUser: true, aal: aal1 })).toBeNull();
  });
  it('forces 2FA users with a password-only session to /login/mfa on every protected page', () => {
    for (const path of ['/', '/admin/users', '/account/security', '/deactivated']) {
      expect(decideRedirect({ path, hasUser: true, aal: needsMfa })).toBe('/login/mfa');
    }
  });
  it('keeps 2FA users on /login/mfa until verified', () => {
    expect(decideRedirect({ path: '/login/mfa', hasUser: true, aal: needsMfa })).toBeNull();
  });
  it('sends fully signed-in users away from /login and /login/mfa', () => {
    expect(decideRedirect({ path: '/login', hasUser: true, aal: aal2 })).toBe('/');
    expect(decideRedirect({ path: '/login/mfa', hasUser: true, aal: aal1 })).toBe('/');
  });
  it('sends half-signed-in users from /login to /login/mfa', () => {
    expect(decideRedirect({ path: '/login', hasUser: true, aal: needsMfa })).toBe('/login/mfa');
  });
  it('never redirects the confirm route (invite links must work while signed in)', () => {
    expect(decideRedirect({ path: '/auth/confirm', hasUser: true, aal: aal2 })).toBeNull();
  });
  it('sends a user who must set up 2FA again to Account → Security from any other page', () => {
    for (const path of ['/', '/admin/users', '/patients', '/my', '/account/set-password']) {
      expect(decideRedirect({ path, hasUser: true, aal: aal1, mfaSetupRequired: true })).toBe('/account/security');
    }
  });
  it('lets them reach Account → Security, sign-in pages and the deactivated page', () => {
    for (const path of ['/account/security', '/login/forgot', '/auth/confirm', '/deactivated']) {
      expect(decideRedirect({ path, hasUser: true, aal: aal1, mfaSetupRequired: true })).toBeNull();
    }
    expect(decideRedirect({ path: '/login', hasUser: true, aal: aal1, mfaSetupRequired: true })).toBe('/');
  });
});

describe('verifiedAal (C1: never trust factors from the session cookie)', () => {
  it('requires aal2 when the server-verified user has a verified factor and the token is aal1', () => {
    expect(verifiedAal([{ status: 'verified' }], 'aal1')).toEqual({ current: 'aal1', next: 'aal2' });
  });
  it('ignores unverified factors', () => {
    expect(verifiedAal([{ status: 'unverified' }], 'aal1')).toEqual({ current: 'aal1', next: 'aal1' });
  });
  it('treats a missing aal claim as aal1 (fail closed)', () => {
    expect(verifiedAal([{ status: 'verified' }], undefined)).toEqual({ current: 'aal1', next: 'aal2' });
  });
  it('accepts an aal2 token', () => {
    expect(verifiedAal([{ status: 'verified' }], 'aal2')).toEqual({ current: 'aal2', next: 'aal2' });
  });
  it('handles users with no factors list', () => {
    expect(verifiedAal(undefined, 'aal1')).toEqual({ current: 'aal1', next: 'aal1' });
  });
});

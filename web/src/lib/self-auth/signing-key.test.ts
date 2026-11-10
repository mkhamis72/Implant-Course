import { describe, it, expect } from 'vitest';
import { scopeForSecret, signingKey } from './signing-key';

const TENANT = { SELF_AUTH_PRIVATE_JWK: '{"kty":"EC","d":"tenant"}', SELF_AUTH_KID: 'tenant-kid' };
const CONSOLE = { CONTROL_SELF_AUTH_PRIVATE_JWK: '{"kty":"EC","d":"console"}', CONTROL_SELF_AUTH_KID: 'console-kid' };

describe('signingKey', () => {
  it('tenant_uses_the_shared_key', () => {
    expect(signingKey('tenant', { ...TENANT, ...CONSOLE })).toEqual({ privateJwk: { kty: 'EC', d: 'tenant' }, kid: 'tenant-kid' });
  });

  it('console_uses_its_own_key_when_set', () => {
    // Supabase allows a key id in one project only, so the control project needs a key of its own.
    expect(signingKey('console', { ...TENANT, ...CONSOLE })).toEqual({ privateJwk: { kty: 'EC', d: 'console' }, kid: 'console-kid' });
  });

  it('console_falls_back_to_the_shared_key', () => {
    expect(signingKey('console', TENANT)).toEqual({ privateJwk: { kty: 'EC', d: 'tenant' }, kid: 'tenant-kid' });
  });

  it('console_half_configured_is_refused', () => {
    expect(() => signingKey('console', { ...TENANT, CONTROL_SELF_AUTH_KID: 'console-kid' })).toThrow('CONTROL_SELF_AUTH_PRIVATE_JWK');
    expect(() => signingKey('console', { ...TENANT, CONTROL_SELF_AUTH_PRIVATE_JWK: CONSOLE.CONTROL_SELF_AUTH_PRIVATE_JWK })).toThrow('CONTROL_SELF_AUTH_KID');
  });

  it('missing_or_bad_key_is_refused_without_quoting_it', () => {
    expect(() => signingKey('tenant', { SELF_AUTH_KID: 'k' })).toThrow('SELF_AUTH_PRIVATE_JWK');
    let message = '';
    try { signingKey('tenant', { SELF_AUTH_PRIVATE_JWK: '{"d":"secret-part', SELF_AUTH_KID: 'k' }); } catch (e) { message = (e as Error).message; }
    expect(message).toBe('SELF_AUTH_PRIVATE_JWK is not valid JSON');
    expect(() => signingKey('console', { ...TENANT, ...CONSOLE, CONTROL_SELF_AUTH_PRIVATE_JWK: 'nope' })).toThrow('CONTROL_SELF_AUTH_PRIVATE_JWK is not valid JSON');
  });
});

describe('scopeForSecret', () => {
  it('maps the console secret to the console key', () => {
    expect(scopeForSecret('CONTROL_SELF_AUTH_SECRET')).toBe('console');
    expect(scopeForSecret('SELF_AUTH_SECRET')).toBe('tenant');
  });
});

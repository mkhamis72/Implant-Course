import { describe, it, expect } from 'vitest';
import { signingKey } from './signing-key';

const TENANT = { SELF_AUTH_PRIVATE_JWK: '{"kty":"EC","d":"tenant"}', SELF_AUTH_KID: 'tenant-kid' };
const LEFTOVER = { CONTROL_SELF_AUTH_PRIVATE_JWK: '{"kty":"EC","d":"console"}', CONTROL_SELF_AUTH_KID: 'console-kid' };

describe('signingKey (release 3: one key pair, the project\'s)', () => {
  it('uses SELF_AUTH_* and ignores leftover CONTROL_SELF_AUTH_* settings', () => {
    expect(signingKey({ ...TENANT, ...LEFTOVER })).toEqual({ privateJwk: { kty: 'EC', d: 'tenant' }, kid: 'tenant-kid' });
  });

  it('missing_or_bad_key_is_refused_without_quoting_it', () => {
    expect(() => signingKey({ SELF_AUTH_KID: 'k' })).toThrow('SELF_AUTH_PRIVATE_JWK');
    let message = '';
    try { signingKey({ SELF_AUTH_PRIVATE_JWK: '{"d":"secret-part', SELF_AUTH_KID: 'k' }); } catch (e) { message = (e as Error).message; }
    expect(message).toBe('SELF_AUTH_PRIVATE_JWK is not valid JSON');
  });
});

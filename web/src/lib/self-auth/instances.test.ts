import { describe, it, expect, vi, beforeEach } from 'vitest';

const { createSelfAuth } = vi.hoisted(() => ({ createSelfAuth: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@mkhamis72/self-auth', () => ({ createSelfAuth }));
vi.mock('./email', () => ({ emailAdapter: { send: vi.fn() } }));
import { tenantAuth } from './tenant';
import { consoleAuth, CONSOLE_COMPANY } from './console';

type Cfg = { databaseUrl: string; secret: string; dbToken: { kid: string; privateJwk: unknown } };
const jwk = { kty: 'EC', crv: 'P-256', x: 'x', y: 'y', d: 'd', kid: 'k1' };
beforeEach(() => {
  createSelfAuth.mockReset();
  createSelfAuth.mockImplementation(async (c) => ({ cfg: c }));
  Object.assign(process.env, {
    DATABASE_URL: 'postgresql://t', CONTROL_DATABASE_URL: 'postgresql://c',
    SELF_AUTH_SECRET: 's'.repeat(32), CONTROL_SELF_AUTH_SECRET: 'c'.repeat(32),
    SELF_AUTH_PRIVATE_JWK: JSON.stringify(jwk), SELF_AUTH_KID: 'k1',
  });
  delete process.env.SELF_AUTH_DATABASE_URL;
  // The console falls back to the shared key only when it has none of its own.
  delete process.env.CONTROL_SELF_AUTH_PRIVATE_JWK;
  delete process.env.CONTROL_SELF_AUTH_KID;
});

describe('instances', () => {
  it('tenant and console use their own database and secret, the same key, and are cached', async () => {
    const t = (await tenantAuth()) as unknown as { cfg: Cfg };
    const c = (await consoleAuth()) as unknown as { cfg: Cfg };
    expect(await tenantAuth()).toBe(t);
    expect(await consoleAuth()).toBe(c);
    expect(createSelfAuth).toHaveBeenCalledTimes(2);
    expect(t.cfg.databaseUrl).toBe('postgresql://t');
    expect(c.cfg.databaseUrl).toBe('postgresql://c');
    expect(t.cfg.secret).not.toBe(c.cfg.secret);
    expect(t.cfg.dbToken.kid).toBe('k1');
    expect(c.cfg.dbToken.privateJwk).toEqual(t.cfg.dbToken.privateJwk);
    expect(CONSOLE_COMPANY).toBe('console');
  });
  it('malformed_jwk_error_has_no_key_material', async () => {
    process.env.SELF_AUTH_PRIVATE_JWK = '{"d":"SECRETKEYMATERIAL" oops';
    vi.resetModules();
    const { tenantAuth: fresh } = await import('./tenant');
    const err = await fresh().catch((e) => e);
    expect(String(err.message)).toBe('SELF_AUTH_PRIVATE_JWK is not valid JSON');
    expect(JSON.stringify(err, Object.getOwnPropertyNames(err))).not.toMatch(/SECRETKEYMATERIAL/);
    expect(err.cause).toBeUndefined();
  });
  it('SELF_AUTH_DATABASE_URL (session pooler) overrides DATABASE_URL for the tenant', async () => {
    process.env.SELF_AUTH_DATABASE_URL = 'postgresql://session-pooler';
    // module caches per process, so build through a fresh import
    vi.resetModules();
    const { tenantAuth: fresh } = await import('./tenant');
    expect(((await fresh()) as unknown as { cfg: Cfg }).cfg.databaseUrl).toBe('postgresql://session-pooler');
  });
});

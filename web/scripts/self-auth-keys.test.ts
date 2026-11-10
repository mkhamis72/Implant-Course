import { describe, expect, it, vi } from 'vitest';
import { parseKeysArgs, probe, probeToken, reachCheck } from './self-auth-keys';

describe('self-auth-keys', () => {
  it('parses jwks and check, refusing anything else', () => {
    expect(parseKeysArgs(['jwks'])).toEqual({ cmd: 'jwks', control: false });
    expect(parseKeysArgs(['jwks', '--control'])).toEqual({ cmd: 'jwks', control: true });
    expect(parseKeysArgs(['check'])).toEqual({ cmd: 'check', control: false, rest: [] });
    expect(parseKeysArgs(['check', '--tenant', 'academy'])).toEqual({ cmd: 'check', control: false, rest: ['--tenant', 'academy'] });
    expect(parseKeysArgs(['check', '--control'])).toEqual({ cmd: 'check', control: true, rest: [] });
    expect(parseKeysArgs(['reach'])).toEqual({ cmd: 'reach', rest: [] });
    expect(parseKeysArgs(['reach', '--tenant', 'academy'])).toEqual({ cmd: 'reach', rest: ['--tenant', 'academy'] });
    expect(() => parseKeysArgs(['reach', '--control'])).toThrow(/Usage/);
    for (const bad of [[], ['jwks', 'x'], ['check', '--tenant'], ['check', '--control', '--tenant', 'a'], ['mint']]) {
      expect(() => parseKeysArgs(bad)).toThrow(/Usage/);
    }
  });

  it('mints a token for a made-up session of the company', async () => {
    const issueDbToken = vi.fn().mockResolvedValue('tok');
    expect(await probeToken({ issueDbToken }, 'c1')).toBe('tok');
    expect(issueDbToken.mock.calls[0][0]).toMatchObject({ companyId: 'c1', aal: 'aal1', userId: '00000000-0000-0000-0000-000000000000' });
  });

  it('passes on 200, explains a 401, and never prints the token', async () => {
    const call = (status: number) => {
      const f = vi.fn().mockResolvedValue(new Response('{}', { status }));
      return { f, run: probe({ supabaseUrl: 'https://p.supabase.co/', anonKey: 'anon', rpc: 'branding_for', body: { p_company: 'c1' }, token: 'SECRET-TOKEN' }, f) };
    };
    const ok = call(200);
    expect(await ok.run).toMatchObject({ ok: true });
    expect(ok.f).toHaveBeenCalledWith('https://p.supabase.co/rest/v1/rpc/branding_for', expect.objectContaining({ method: 'POST' }));
    expect(ok.f.mock.calls[0][1].headers).toMatchObject({ apikey: 'anon', authorization: 'Bearer SECRET-TOKEN' });
    const refused = await call(401).run;
    expect(refused.ok).toBe(false);
    expect(refused.line).toMatch(/401.*standby key/);
    expect(refused.line).not.toContain('SECRET-TOKEN');
    expect((await call(500).run).ok).toBe(false);
  });
});

describe('reachCheck (Self-Auth over its own database URL, after Migration A)', () => {
  const auth = (impl: () => Promise<unknown>) => ({ getSession: vi.fn<(token: string, companyId: string) => Promise<unknown>>(impl) });

  it('passes when Self-Auth queries its tables (no session for a random token)', async () => {
    const a = auth(async () => null);
    expect(await reachCheck(a, 'c1', 'SELF_AUTH_DATABASE_URL')).toEqual({ ok: true, line: 'Self-Auth database: reachable over SELF_AUTH_DATABASE_URL.' });
    expect(a.getSession.mock.calls[0][1]).toBe('c1');
  });

  it('reports a database before Migration A as not migrated yet, not a crash', async () => {
    for (const e of [Object.assign(new Error('relation "self_auth.session" does not exist'), { code: '42P01' }),
      new Error('relation "self_auth.session" does not exist'), Object.assign(new Error('x'), { code: '3F000' })]) {
      const r = await reachCheck(auth(async () => { throw e; }), 'c1', 'DATABASE_URL');
      expect(r.ok).toBe(false);
      expect(r.line).toMatch(/not migrated yet/);
    }
  });

  it('reports other failures by class or code, never the message', async () => {
    const r = await reachCheck(auth(async () => { throw Object.assign(new Error('password authentication failed for user secret'), { code: '28P01' }); }), 'c1', 'DATABASE_URL');
    expect(r).toEqual({ ok: false, line: 'Self-Auth database: unreachable over DATABASE_URL (28P01).' });
  });
});

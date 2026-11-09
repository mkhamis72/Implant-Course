import { describe, expect, it, vi } from 'vitest';
import { parseKeysArgs, probe, probeToken } from './self-auth-keys';

describe('self-auth-keys', () => {
  it('parses jwks and check, refusing anything else', () => {
    expect(parseKeysArgs(['jwks'])).toEqual({ cmd: 'jwks' });
    expect(parseKeysArgs(['check'])).toEqual({ cmd: 'check', control: false, rest: [] });
    expect(parseKeysArgs(['check', '--tenant', 'academy'])).toEqual({ cmd: 'check', control: false, rest: ['--tenant', 'academy'] });
    expect(parseKeysArgs(['check', '--control'])).toEqual({ cmd: 'check', control: true, rest: [] });
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

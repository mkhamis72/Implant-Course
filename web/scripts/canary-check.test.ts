import { describe, it, expect, vi } from 'vitest';
import { evaluateCanary, canaryInputs, projectMismatch, signInCanary } from './canary-check';

const zero = (table: string) => ({ table, academyRows: 0 });

describe('evaluateCanary', () => {
  it('passes when every table shows 0 academy rows and the canary sees its own settings', () => {
    const r = evaluateCanary([zero('patients'), zero('courses')], 1);
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
    expect(r.lines).toEqual(['courses: 0 academy rows', 'patients: 0 academy rows']);
  });

  it('fails on any academy row, naming the table and the count', () => {
    const r = evaluateCanary([zero('courses'), { table: 'patients', academyRows: 3 }], 1);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['patients: 3 academy rows visible to the canary session']);
  });

  it('treats a closed table (permission denied) as nothing visible, but any other failure as a problem', () => {
    const closed = { table: 'stock_movements', academyRows: null, errorCode: '42501', errorMessage: 'permission denied' };
    expect(evaluateCanary([zero('patients'), closed], 1).ok).toBe(true);
    const broken = { table: 'talks', academyRows: null, errorCode: 'PGRST205', errorMessage: 'not found' };
    const r = evaluateCanary([zero('patients'), broken], 1);
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toContain('talks: the query failed (PGRST205: not found)');
  });

  it('fails when the canary cannot see its own settings (an unbound session proves nothing)', () => {
    expect(evaluateCanary([zero('patients')], 0).ok).toBe(false);
    expect(evaluateCanary([zero('patients')], null).ok).toBe(false);
  });

  it('fails on an empty table list', () => {
    const r = evaluateCanary([], 1);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual(['no company tables were checked']);
  });
});

describe('canaryInputs', () => {
  const env = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    CANARY_EMAIL: 'c@example.com',
    CANARY_PASSWORD: 'pw',
    CANARY_COMPANY_ID: 'id',
  };

  it('reads the owner-supplied values, the TOTP being optional', () => {
    expect(canaryInputs(env)).toMatchObject({ email: 'c@example.com', password: 'pw', companyId: 'id', totp: undefined });
    expect(canaryInputs({ ...env, CANARY_TOTP: '123456' }).totp).toBe('123456');
  });

  it('names the missing variable without echoing any value', () => {
    expect(() => canaryInputs({ ...env, CANARY_PASSWORD: undefined })).toThrow('CANARY_PASSWORD is not set');
  });
});

describe('projectMismatch', () => {
  it('accepts the same hosted project through the API url and the direct or pooler database url', () => {
    expect(projectMismatch('https://abc123.supabase.co', 'postgresql://postgres:x@db.abc123.supabase.co:5432/postgres')).toBeNull();
    expect(projectMismatch('https://abc123.supabase.co', 'postgresql://postgres.abc123:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres')).toBeNull();
  });
  it('refuses different projects', () => {
    expect(projectMismatch('https://abc123.supabase.co', 'postgresql://postgres:x@db.zzz999.supabase.co:5432/postgres')).toContain('different projects');
    expect(projectMismatch('https://abc123.supabase.co', 'postgresql://postgres.zzz999:x@aws-0-eu-central-1.pooler.supabase.com:5432/postgres')).toContain('different projects');
  });
  it('reads a ref only from a real supabase.co host (dots are literal)', () => {
    expect(projectMismatch('https://abc123xsupabasexco', 'postgresql://postgres:x@abc123.supabase.co:5432/postgres')).toContain('different projects');
    expect(projectMismatch('https://abc123.supabase.co', 'postgresql://postgres:x@dbxabc123.supabase.co:5432/postgres')).toContain('different projects');
  });
  it('compares hosts on a local stack', () => {
    expect(projectMismatch('http://127.0.0.1:54321', 'postgresql://postgres:postgres@127.0.0.1:54322/postgres')).toBeNull();
    expect(projectMismatch('http://127.0.0.1:54321', 'postgresql://postgres:postgres@db.example.com:5432/postgres')).toContain('different projects');
  });
});

describe('signInCanary (Self-Auth, not Supabase Auth)', () => {
  const session = { sessionId: 's1', userId: 'u1', companyId: 'c1', email: 'c@x', aal: 'aal1' as const, expiresAt: new Date() };
  const input = { email: 'c@x', password: 'pw', companyId: 'c1' };
  function fakeAuth(over: { needsTotp?: boolean; ok?: boolean; verify?: unknown } = {}) {
    return {
      signIn: vi.fn(async () => (over.ok === false
        ? { ok: false as const, reason: 'invalid_credentials' as const }
        : { ok: true as const, sessionToken: 'tok', session, needsTotp: over.needsTotp ?? false })),
      totp: { verify: vi.fn(async () => (over.verify === undefined ? { ...session, aal: 'aal2' as const } : over.verify)) },
      issueDbToken: vi.fn(async (s: { aal: string }) => `db-token-${s.aal}`),
      signOut: vi.fn(async () => undefined),
    };
  }

  it('signs in to the canary company and mints a database token for the session', async () => {
    const auth = fakeAuth();
    const s = await signInCanary(auth as never, input);
    expect(auth.signIn).toHaveBeenCalledWith({ companyId: 'c1', email: 'c@x', password: 'pw' });
    expect(s.dbToken).toBe('db-token-aal1');
    await s.signOut();
    expect(auth.signOut).toHaveBeenCalledWith('tok');
  });
  it('verifies the 2FA code when the account has one, and uses the raised session', async () => {
    const auth = fakeAuth({ needsTotp: true });
    const s = await signInCanary(auth as never, { ...input, totp: '123456' });
    expect(auth.totp.verify).toHaveBeenCalledWith('tok', 'c1', '123456');
    expect(s.dbToken).toBe('db-token-aal2');
  });
  it('refuses without a code, with a wrong code, or a failed sign-in (and ends the session it made)', async () => {
    const noCode = fakeAuth({ needsTotp: true });
    await expect(signInCanary(noCode as never, input)).rejects.toThrow(/CANARY_TOTP/);
    expect(noCode.signOut).toHaveBeenCalledWith('tok');
    const wrong = fakeAuth({ needsTotp: true, verify: null });
    await expect(signInCanary(wrong as never, { ...input, totp: '000000' })).rejects.toThrow(/2FA failed/);
    expect(wrong.signOut).toHaveBeenCalledWith('tok');
    await expect(signInCanary(fakeAuth({ ok: false }) as never, input)).rejects.toThrow(/Sign-in failed: invalid_credentials/);
  });
  it('the script no longer signs in through Supabase Auth', async () => {
    const src = (await import('node:fs')).readFileSync(`${process.cwd()}/scripts/canary-check.ts`, 'utf8');
    expect(src).not.toMatch(/auth\.signInWithPassword|auth\.mfa\./);
  });
});

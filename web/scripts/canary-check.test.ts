import { describe, it, expect } from 'vitest';
import { evaluateCanary, canaryInputs } from './canary-check';

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

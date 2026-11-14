import { describe, it, expect, vi, beforeEach } from 'vitest';
const { pgConfig } = vi.hoisted(() => ({ pgConfig: vi.fn((env?: Record<string, string | undefined>) => ({ connectionString: env?.DATABASE_URL || '' })) }));
vi.mock('./db', () => ({ pgConfig }));
import pathModule from 'node:path';
import { migrateTarget } from './migrate-target';

const env = {
  DATABASE_URL: 'postgres://app', NEXT_PUBLIC_SUPABASE_URL: 'https://app.supabase.co', DATABASE_CA_CERT: 'ca.crt',
  CONTROL_DATABASE_URL: 'postgres://control', CONTROL_SUPABASE_URL: 'https://ctl.supabase.co',
};

describe('migrateTarget', () => {
  beforeEach(() => pgConfig.mockClear());

  it('defaults to the app database and migrations', () => {
    const t = migrateTarget([], env);
    expect(t.dir).toBe(pathModule.join(process.cwd(), 'supabase', 'migrations'));
    expect(t.config.connectionString).toBe('postgres://app');
    expect(t.label).toBe('app.supabase.co');
    expect(pgConfig).toHaveBeenCalledWith(env);
  });
  it('--control is gone: there is one database', () => {
    expect(() => migrateTarget(['--control'], env)).toThrow('--all-tenants / --control are gone');
  });
});

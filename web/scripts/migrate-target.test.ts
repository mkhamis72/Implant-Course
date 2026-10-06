import { describe, it, expect, vi } from 'vitest';
vi.mock('./db', () => ({
  pgConfig: (env?: Record<string, string | undefined>) => ({
    connectionString: env?.DATABASE_URL || 'postgres://app',
    ssl: env?.DATABASE_CA_CERT ? { ca: 'CA' } : undefined,
  }),
}));
import pathModule from 'node:path';
import { migrateTarget } from './migrate-target';

const env = {
  DATABASE_URL: 'postgres://app', NEXT_PUBLIC_SUPABASE_URL: 'https://app.supabase.co', DATABASE_CA_CERT: 'ca.crt',
  CONTROL_DATABASE_URL: 'postgres://control', CONTROL_SUPABASE_URL: 'https://ctl.supabase.co',
};

describe('migrateTarget', () => {
  it('defaults to the app database and migrations', () => {
    const t = migrateTarget([], env);
    expect(t.dir).toBe(pathModule.join(process.cwd(), 'supabase', 'migrations'));
    expect(t.config.connectionString).toBe('postgres://app');
    expect(t.label).toBe('app.supabase.co');
  });
  it('--control targets the control project and its migrations', () => {
    const t = migrateTarget(['--control'], env);
    expect(t.dir).toBe(pathModule.join(process.cwd(), 'supabase', 'control', 'migrations'));
    expect(t.config.connectionString).toBe('postgres://control');
    expect(t.label).toBe('control ctl.supabase.co');
  });
  it('--control needs CONTROL_DATABASE_URL', () => {
    expect(() => migrateTarget(['--control'], { ...env, CONTROL_DATABASE_URL: undefined })).toThrow(/CONTROL_DATABASE_URL/);
  });
});

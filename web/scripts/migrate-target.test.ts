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
  it('--control targets the control project and its migrations', () => {
    const t = migrateTarget(['--control'], env);
    expect(t.dir).toBe(pathModule.join(process.cwd(), 'supabase', 'control', 'migrations'));
    expect(t.config.connectionString).toBe('postgres://control');
    expect(t.label).toBe('control ctl.supabase.co');
    expect(pgConfig).toHaveBeenCalledWith({ DATABASE_URL: 'postgres://control', DATABASE_CA_CERT: 'ca.crt' });
  });
  it('--control with CONTROL_DATABASE_CA_CERT falls back correctly', () => {
    const envWithCtlCert = { ...env, CONTROL_DATABASE_CA_CERT: 'ctl.crt' };
    const t = migrateTarget(['--control'], envWithCtlCert);
    expect(t.label).toBe('control ctl.supabase.co');
    expect(pgConfig).toHaveBeenCalledWith({ DATABASE_URL: 'postgres://control', DATABASE_CA_CERT: 'ctl.crt' });
  });
  it('--control needs CONTROL_DATABASE_URL', () => {
    expect(() => migrateTarget(['--control'], { ...env, CONTROL_DATABASE_URL: undefined })).toThrow(/CONTROL_DATABASE_URL/);
  });
});

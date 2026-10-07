import { describe, it, expect, vi } from 'vitest';
import { migrateAllTenants } from './migrate-all';
import type { Company } from './tenant-env';

const company = (slug: string): Company => ({
  tenant: { slug, name: slug, status: 'active', supabase_url: `https://${slug}ref.supabase.co`, anon_key: 'anon' },
  secrets: { serviceRoleKey: 'svc', databaseUrl: `postgresql://postgres.${slug}:pw@127.0.0.1:5432/postgres` },
});

describe('migrateAllTenants', () => {
  it('migrates every company in the given order, printing its target first', async () => {
    const log: string[] = [];
    const run = vi.fn().mockResolvedValueOnce(['0041_x.sql']).mockResolvedValueOnce([]);
    await migrateAllTenants([company('aa'), company('bb')], undefined, run, (l) => log.push(l));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0][1]).toMatchObject({ connectionString: 'postgresql://postgres.aa:pw@127.0.0.1:5432/postgres' });
    expect(log).toEqual([
      'Target project: aa aaref.supabase.co', 'Applied: 0041_x.sql',
      'Target project: bb bbref.supabase.co', 'Database is up to date.',
    ]);
  });

  it('stops at the first failure, naming the company and never the database URL', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('Migration 0041_x.sql failed: boom')).mockResolvedValue([]);
    const err = await migrateAllTenants([company('aa'), company('bb')], undefined, run, () => {}).catch((e: Error) => e);
    expect((err as Error).message).toBe('Company aa: Migration 0041_x.sql failed: boom');
    expect((err as Error).message).not.toContain('postgresql://');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty registry', async () => {
    await expect(migrateAllTenants([], undefined, vi.fn(), () => {})).rejects.toThrow('No companies in the control project.');
  });
});

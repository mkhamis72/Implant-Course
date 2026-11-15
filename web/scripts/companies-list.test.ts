import { describe, it, expect } from 'vitest';
import { companySlugs } from './companies-list';

describe('companySlugs (companies:list, for the Backup workflow)', () => {
  it('one slug per line, ordered by slug, active and suspended alike', async () => {
    const queries: string[] = [];
    const db = { query: async (sql: string) => { queries.push(sql); return { rows: [{ slug: 'academy' }, { slug: 'demo' }, { slug: 'osdic' }] }; } };
    expect(await companySlugs(db)).toBe('academy\ndemo\nosdic\n');
    expect(queries[0]).toMatch(/select slug from public\.companies order by slug/);
  });
  it('no companies is an error: a backup of nothing must fail', async () => {
    await expect(companySlugs({ query: async () => ({ rows: [] }) })).rejects.toThrow('No companies in this database');
  });
});

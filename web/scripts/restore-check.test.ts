import { describe, expect, it } from 'vitest';
import { clientConfig, compareCounts } from './restore-check';

describe('compareCounts', () => {
  it('marks a differing table not ok', () => {
    const r = compareCounts({ a: 1, b: 2 }, { a: 1, b: 3 });
    expect(r).toEqual([
      { table: 'a', expected: 1, actual: 1, ok: true },
      { table: 'b', expected: 2, actual: 3, ok: false },
    ]);
  });

  it('marks a table missing from actual as null and not ok', () => {
    expect(compareCounts({ a: 1 }, {})).toEqual([{ table: 'a', expected: 1, actual: null, ok: false }]);
  });
});

describe('clientConfig', () => {
  it('keeps the CA for a hosted host', async () => {
    const { writeFileSync, mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const ca = join(mkdtempSync(join(tmpdir(), 'ca-')), 'ca.crt');
    writeFileSync(ca, 'CERT');
    expect(clientConfig({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/postgres', DATABASE_CA_CERT: ca }).ssl).toEqual({ ca: 'CERT' });
  });
});

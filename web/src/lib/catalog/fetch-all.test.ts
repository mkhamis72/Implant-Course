import { describe, it, expect } from 'vitest';
import { allRows, fetchAll } from './fetch-all';

const pager = (rows: number[], calls: [number, number][] = []) => async (from: number, to: number) => {
  calls.push([from, to]);
  return { data: rows.slice(from, to + 1), error: null };
};

describe('fetchAll', () => {
  it('reads every page until a short one, past the API row limit', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const calls: [number, number][] = [];
    expect(await fetchAll(pager(rows, calls), 1000)).toEqual(rows);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops after an exactly full last page with one more empty read', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => i);
    expect(await fetchAll(pager(rows), 1000)).toHaveLength(2000);
  });

  it('throws on an error', async () => {
    await expect(fetchAll(async () => ({ data: null, error: { message: 'boom' } }), 1000)).rejects.toThrow('boom');
  });
});

describe('allRows', () => {
  it('returns every row past the API row limit as { data, error: null }', async () => {
    const rows = Array.from({ length: 1018 }, (_, i) => i);
    expect(await allRows(pager(rows))).toEqual({ data: rows, error: null });
  });

  it('turns a failed page into { data: null, error } instead of throwing', async () => {
    expect(await allRows(async () => ({ data: null, error: { message: 'boom' } })))
      .toEqual({ data: null, error: { message: 'boom' } });
  });
});

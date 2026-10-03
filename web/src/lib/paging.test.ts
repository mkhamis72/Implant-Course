import { describe, it, expect } from 'vitest';
import { firstPage, showAllHref } from './paging';

describe('firstPage', () => {
  const rows = Array.from({ length: 120 }, (_, i) => i);
  it('shows the first page and says how many are hidden', () => {
    expect(firstPage(rows, false, 50)).toEqual({ shown: rows.slice(0, 50), hidden: 70 });
  });
  it('shows everything when asked or when it fits', () => {
    expect(firstPage(rows, true, 50)).toEqual({ shown: rows, hidden: 0 });
    expect(firstPage(rows.slice(0, 10), false, 50)).toEqual({ shown: rows.slice(0, 10), hidden: 0 });
  });
});

describe('showAllHref', () => {
  it('keeps the current filters and adds rows=all', () => {
    expect(showAllHref('/inventory', { q: 'MIS', category: '', all: '1' })).toBe('/inventory?q=MIS&all=1&rows=all');
  });
});

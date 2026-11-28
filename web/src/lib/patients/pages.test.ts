import { describe, it, expect } from 'vitest';
import { PAGE_SIZE, lastPage, pageHref, pageList, pageSummary, parsePage } from './pages';

describe('parsePage', () => {
  it('reads a whole page number of 1 or more', () => {
    expect(parsePage('3')).toBe(3);
    expect(parsePage(['2', '9'])).toBe(2);
  });

  it('falls back to 1 for missing, out-of-range or garbage values', () => {
    for (const v of [undefined, '', '0', '-2', 'abc', '2.5', '1e3', ' 4', '99999999', '99999999999999999999']) {
      expect(parsePage(v), String(v)).toBe(1);
    }
  });
});

describe('lastPage', () => {
  it('is at least 1 and rounds up', () => {
    expect(lastPage(0)).toBe(1);
    expect(lastPage(50)).toBe(1);
    expect(lastPage(51)).toBe(2);
    expect(lastPage(312)).toBe(7);
    expect(PAGE_SIZE).toBe(50);
  });
});

describe('pageList', () => {
  it('is a single page for 1 page', () => {
    expect(pageList(1, 1)).toEqual([1]);
  });

  it('lists every page for 7 pages when nothing is far from the current one', () => {
    expect(pageList(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageList(1, 7)).toEqual([1, 2, 3, '…', 7]);
    expect(pageList(7, 7)).toEqual([1, '…', 5, 6, 7]);
  });

  it('shows the first, the last and two either side of the current page for 30 pages', () => {
    expect(pageList(15, 30)).toEqual([1, '…', 13, 14, 15, 16, 17, '…', 30]);
    expect(pageList(1, 30)).toEqual([1, 2, 3, '…', 30]);
    expect(pageList(30, 30)).toEqual([1, '…', 28, 29, 30]);
    expect(pageList(4, 30)).toEqual([1, 2, 3, 4, 5, 6, '…', 30]);
  });

  it('puts no gap where only one page would be skipped', () => {
    expect(pageList(5, 30)).toEqual([1, 2, 3, 4, 5, 6, 7, '…', 30]);
  });
});

describe('pageHref', () => {
  const filters = { q: 'ali & co', archived: '1', stages: ['missing', 'placed'], course: 'c1', supervisor: 's1', stagesNot: false, courseNot: false, supervisorNot: false };

  it('keeps every filter, including repeated stages, and the page', () => {
    const url = new URL(pageHref(filters, 3), 'http://x');
    expect(url.pathname).toBe('/patients');
    expect(url.searchParams.get('q')).toBe('ali & co');
    expect(url.searchParams.get('archived')).toBe('1');
    expect(url.searchParams.getAll('stage')).toEqual(['missing', 'placed']);
    expect(url.searchParams.get('course')).toBe('c1');
    expect(url.searchParams.get('supervisor')).toBe('s1');
    expect(url.searchParams.get('page')).toBe('3');
  });

  it('keeps the is-not flags on every page and omits them when off', () => {
    const on = new URL(pageHref({ ...filters, stagesNot: true, courseNot: true, supervisorNot: true }, 2), 'http://x');
    expect(on.searchParams.get('stage_not')).toBe('1');
    expect(on.searchParams.get('course_not')).toBe('1');
    expect(on.searchParams.get('supervisor_not')).toBe('1');
    const off = new URL(pageHref(filters, 2), 'http://x');
    expect(off.searchParams.has('stage_not') || off.searchParams.has('course_not') || off.searchParams.has('supervisor_not')).toBe(false);
  });

  it('leaves out empty filters and page 1', () => {
    expect(pageHref({ q: '', archived: '', stages: [], course: '', supervisor: '', stagesNot: false, courseNot: false, supervisorNot: false }, 1)).toBe('/patients');
    expect(pageHref({ q: 'x', archived: '', stages: [], course: '', supervisor: '', stagesNot: false, courseNot: false, supervisorNot: false }, 2)).toBe('/patients?q=x&page=2');
  });
});

describe('pageSummary', () => {
  it('names the rows shown and the total', () => {
    expect(pageSummary(2, 312)).toBe('Patients 51–100 of 312');
    expect(pageSummary(7, 312)).toBe('Patients 301–312 of 312');
    expect(pageSummary(1, 1)).toBe('Patients 1–1 of 1');
  });
});

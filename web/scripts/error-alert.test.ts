import { describe, it, expect, vi } from 'vitest';
import { checkSites, runErrorCheck, siteUrls, summarise } from './error-alert';

describe('summarise', () => {
  it('groups equal messages, most frequent first, with the last time each was seen', () => {
    const rows = [
      { at: new Date('2026-11-15T10:00:00Z'), message: 'sendEmail failed: 535' },
      { at: new Date('2026-11-15T10:05:00Z'), message: 'sendEmail failed: 535' },
      { at: new Date('2026-11-15T10:02:00Z'), message: 'EMAXCONNSESSION' },
    ];
    expect(summarise(rows)).toEqual([
      '2× sendEmail failed: 535 (last 2026-11-15 10:05 UTC)',
      '1× EMAXCONNSESSION (last 2026-11-15 10:02 UTC)',
    ]);
  });
  it('lists at most 20 kinds and says how many more there are', () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({ at: new Date(0), message: `e${i}` }));
    const lines = summarise(rows);
    expect(lines).toHaveLength(21);
    expect(lines[20]).toBe('… and 5 more kinds of error');
  });
});

describe('siteUrls', () => {
  it('the first address of every active company, and the console', () => {
    expect(siteUrls([{ hosts: ['kaleidoscope.imploid.net', 'implant-course.vercel.app'] }, { hosts: ['osdic.imploid.net'] }, { hosts: [] }], 'console.imploid.net'))
      .toEqual(['https://kaleidoscope.imploid.net/login', 'https://osdic.imploid.net/login', 'https://console.imploid.net/console/login']);
  });
});

describe('checkSites', () => {
  it('reports any address that does not answer 200, or does not answer at all', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('down')) throw new Error('timeout');
      return new Response(null, { status: url.includes('busy') ? 503 : 200 });
    }) as unknown as typeof fetch;
    expect(await checkSites(['https://ok.x/login', 'https://busy.x/login', 'https://down.x/login'], fetchImpl))
      .toEqual(['https://busy.x/login answered 503', 'https://down.x/login did not answer (timeout)']);
  });
});

describe('runErrorCheck', () => {
  /** A fake database: errors since the marker, the active companies, and every statement it was sent. */
  function fakeDb(errors: { at: Date; message: string }[], checkedAt: Date | null) {
    const sql: string[] = [];
    return {
      sql,
      async query(text: string) {
        sql.push(text.replace(/\s+/g, ' ').trim());
        if (text.includes('from public.error_alert_state')) return { rows: checkedAt ? [{ checked_at: checkedAt }] : [] };
        if (text.includes('from public.error_log')) return { rows: errors };
        if (text.includes('from public.companies')) return { rows: [{ hosts: ['a.imploid.net'] }] };
        return { rows: [] };
      },
    };
  }
  const allUp = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;

  it('new errors fail the check; the marker moves on and old entries are deleted, in one transaction', async () => {
    const db = fakeDb([{ at: new Date('2026-11-15T10:00:00Z'), message: 'sendEmail failed' }], new Date('2026-11-15T09:00:00Z'));
    const r = await runErrorCheck(db, allUp, 'console.imploid.net');
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('1× sendEmail failed');
    expect(db.sql[0]).toBe('begin');
    expect(db.sql.some((s) => s.startsWith('insert into public.error_alert_state'))).toBe(true);
    expect(db.sql.some((s) => s.startsWith("delete from public.error_log where at < now() - interval '30 days'"))).toBe(true);
    expect(db.sql).toContain('commit');
  });
  it('no new errors and every site up: passes', async () => {
    const r = await runErrorCheck(fakeDb([], new Date()), allUp, 'console.imploid.net');
    expect(r).toEqual({ ok: true, lines: ['No new errors. Every site answers.'] });
  });
  it('a site that is down fails the check even with no errors', async () => {
    const down = (async () => new Response(null, { status: 503 })) as unknown as typeof fetch;
    const r = await runErrorCheck(fakeDb([], new Date()), down, 'console.imploid.net');
    expect(r.ok).toBe(false);
    expect(r.lines.join('\n')).toContain('answered 503');
  });
  it('the first run looks back one hour', async () => {
    const db = fakeDb([], null);
    await runErrorCheck(db, allUp, 'console.imploid.net');
    expect(db.sql.find((s) => s.includes('from public.error_log'))).toContain("now() - interval '1 hour'");
  });
});

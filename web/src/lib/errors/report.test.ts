import { describe, it, expect, vi, afterEach } from 'vitest';
import { createReporter, errorText, installErrorReporting, redact, REPORT_LIMIT_PER_MINUTE } from './report';

describe('redact', () => {
  it('masks email addresses, long tokens and database credentials; keeps ids and words', () => {
    const jwt = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz0123456789';
    const text = `invite to Ann@Acme.com failed; token ${jwt}; db postgresql://postgres.abc:S3cret-pw@pooler.supabase.com:5432/postgres; id 808efe9a-a72d-4c00-98bd-c392373b0350`;
    expect(redact(text)).toBe('invite to [email] failed; token [token]; db postgresql://[credentials]@pooler.supabase.com:5432/postgres; id 808efe9a-a72d-4c00-98bd-c392373b0350');
  });
});

describe('errorText', () => {
  it('joins console arguments; an Error gives its name and message, never its stack', () => {
    const e = new TypeError('fetch failed');
    expect(errorText(['sendEmail failed:', e])).toBe('sendEmail failed: TypeError: fetch failed');
    expect(errorText(['self-auth signIn failed:', { code: 'XX000' }])).toBe('self-auth signIn failed: {"code":"XX000"}');
  });
  it('is masked and cut to 1000 characters', () => {
    const t = errorText(['x'.repeat(2000), 'ann@acme.com']);
    expect(t.length).toBe(1000);
    expect(errorText(['to ann@acme.com'])).toBe('to [email]');
  });
});

describe('createReporter', () => {
  it(`sends at most ${REPORT_LIMIT_PER_MINUTE} errors a minute per server instance, then again the next minute`, () => {
    let now = 0;
    const send = vi.fn(async () => undefined);
    const report = createReporter(send, () => now);
    for (let i = 0; i < REPORT_LIMIT_PER_MINUTE + 5; i++) report(`e${i}`);
    expect(send).toHaveBeenCalledTimes(REPORT_LIMIT_PER_MINUTE);
    now = 61_000;
    report('later');
    expect(send).toHaveBeenLastCalledWith('later');
  });
  it('a failed send is swallowed', async () => {
    const report = createReporter(async () => { throw new Error('down'); }, () => 0);
    expect(() => report('x')).not.toThrow();
  });
});

describe('installErrorReporting', () => {
  const original = console.error;
  afterEach(() => { console.error = original; });
  const env = { VERCEL_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://prod.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc' };

  it('in production, console.error still prints and the error goes to error_log through the API', async () => {
    const printed = vi.fn();
    console.error = printed;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 201 }));
    const waitUntil = vi.fn();
    installErrorReporting({ env, fetchImpl, waitUntil });
    console.error('sendEmail failed: Invalid login: 535 Invalid username for', 'ann@acme.com');
    expect(printed).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://prod.supabase.co/rest/v1/error_log');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).apikey).toBe('svc');
    expect(JSON.parse(String(init.body))).toEqual({ message: 'sendEmail failed: Invalid login: 535 Invalid username for [email]' });
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('outside production (or without the keys) nothing is sent', () => {
    console.error = vi.fn();
    const fetchImpl = vi.fn();
    installErrorReporting({ env: { ...env, VERCEL_ENV: 'preview' }, fetchImpl });
    console.error('x');
    installErrorReporting({ env: { VERCEL_ENV: 'production' }, fetchImpl });
    console.error('y');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('installs once, and an error while sending is never reported again (no loop)', async () => {
    console.error = vi.fn();
    const fetchImpl = vi.fn(async () => { console.error('inner'); throw new Error('down'); });
    installErrorReporting({ env, fetchImpl });
    installErrorReporting({ env, fetchImpl });
    console.error('outer');
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

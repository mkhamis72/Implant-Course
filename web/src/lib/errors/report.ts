/**
 * Error alerts: every server-side console.error in production is also written to public.error_log (0107), through
 * the Supabase API with the service role (a fetch, so no database connection is held). The hourly Error alert
 * workflow reads the new rows and emails the owner by failing. Messages never carry a stack, are masked (emails,
 * tokens, database credentials) and cut to 1000 characters. Reporting never throws and never reports itself.
 * No 'server-only' here: instrumentation loads it, and Vitest runs it.
 */
type Env = Record<string, string | undefined>;

export const REPORT_LIMIT_PER_MINUTE = 20;
const MAX = 1000;
const PATCHED = Symbol.for('implant-course.error-reporting');

const CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 40+ characters mixing letters and digits (JWTs, API keys, session tokens); ids (uuid, 36) and words stay.
const TOKEN = /(?<![A-Za-z0-9_.-])(?=[A-Za-z0-9_.-]*\d)(?=[A-Za-z0-9_.-]*[A-Za-z])[A-Za-z0-9_.-]{40,}/g;

export function redact(text: string): string {
  return text.replace(CREDENTIALS, '$1[credentials]@').replace(EMAIL, '[email]').replace(TOKEN, '[token]');
}

function part(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

/** The console arguments as one masked line of at most 1000 characters. */
export function errorText(args: unknown[]): string {
  return redact(args.map(part).join(' ')).slice(0, MAX);
}

/** Sends at most REPORT_LIMIT_PER_MINUTE messages a minute; a failed send is dropped. */
export function createReporter(send: (message: string) => Promise<unknown>, now: () => number = Date.now) {
  let windowStart = 0;
  let count = 0;
  return (message: string): Promise<unknown> | undefined => {
    const t = now();
    if (t - windowStart >= 60_000) {
      windowStart = t;
      count = 0;
    }
    if (count >= REPORT_LIMIT_PER_MINUTE) return undefined;
    count += 1;
    try {
      return Promise.resolve(send(message)).catch(() => undefined);
    } catch {
      return undefined;
    }
  };
}

/** Patches console.error once (production only, with the project's URL and service key). */
export function installErrorReporting(o: {
  env?: Env;
  fetchImpl?: typeof fetch;
  waitUntil?: (p: Promise<unknown>) => void;
} = {}): void {
  const env = o.env ?? process.env;
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (env.VERCEL_ENV !== 'production' || !url || !key) return;
  const current = console.error as typeof console.error & { [PATCHED]?: true };
  if (current[PATCHED]) return;
  const fetchImpl = o.fetchImpl ?? fetch;
  const endpoint = `${url.replace(/\/+$/, '')}/rest/v1/error_log`;
  const report = createReporter((message) => fetchImpl(endpoint, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', prefer: 'return=minimal' },
    body: JSON.stringify({ message }),
    signal: AbortSignal.timeout(3_000),
  }));
  let reporting = false;
  const patched = (...args: unknown[]) => {
    current.apply(console, args);
    if (reporting) return; // an error while reporting is printed, never reported again
    reporting = true;
    try {
      const sent = report(errorText(args));
      if (sent) o.waitUntil?.(sent);
    } catch {
      // never let reporting break the caller
    } finally {
      reporting = false;
    }
  };
  console.error = Object.assign(patched, { [PATCHED]: true as const });
}

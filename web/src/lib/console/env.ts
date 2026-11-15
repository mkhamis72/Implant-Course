import { normaliseHost } from '@/lib/tenant/host';

type Env = Record<string, string | undefined>;

export function consoleHost(env: Env = process.env): string | null {
  return normaliseHost(env.CONSOLE_HOST ?? null);
}

export type ConsoleConfig = { url: string; anonKey: string; serviceKey: string };

/** The project the console signs in against and writes to: the company project (merge of control, release 3). */
export function consoleConfig(env: Env = process.env): ConsoleConfig {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error('The console is not configured.');
  return { url, anonKey, serviceKey };
}

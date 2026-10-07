import { normaliseHost } from '@/lib/tenant/host';

type Env = Record<string, string | undefined>;

export function consoleHost(env: Env = process.env): string | null {
  return normaliseHost(env.CONSOLE_HOST ?? null);
}

/** The control project the console signs in against and writes to. */
export function controlConfig(env: Env = process.env): { url: string; anonKey: string; serviceKey: string } {
  const url = env.CONTROL_SUPABASE_URL;
  const anonKey = env.NEXT_PUBLIC_CONTROL_ANON_KEY;
  const serviceKey = env.CONTROL_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error('The console is not configured.');
  return { url, anonKey, serviceKey };
}

import { normaliseHost } from '@/lib/tenant/host';
import { listSource } from '@/lib/tenant/source';

type Env = Record<string, string | undefined>;

export function consoleHost(env: Env = process.env): string | null {
  return normaliseHost(env.CONSOLE_HOST ?? null);
}

/** Which project holds the console: production with COMPANY_LIST=production (merge release 2), else control. */
export function consoleSource(env: Env = process.env): 'control' | 'production' {
  return listSource(env) === 'production' ? 'production' : 'control';
}

export type ConsoleConfig = { url: string; anonKey: string; serviceKey: string; source: 'control' | 'production' };

/**
 * The project the console signs in against and writes to: the company project when COMPANY_LIST=production
 * (merge release 2), otherwise the control project.
 */
export function consoleConfig(env: Env = process.env): ConsoleConfig {
  const production = consoleSource(env) === 'production';
  const url = production ? env.NEXT_PUBLIC_SUPABASE_URL : env.CONTROL_SUPABASE_URL;
  const anonKey = production ? env.NEXT_PUBLIC_SUPABASE_ANON_KEY : env.NEXT_PUBLIC_CONTROL_ANON_KEY;
  const serviceKey = production ? env.SUPABASE_SERVICE_ROLE_KEY : env.CONTROL_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) throw new Error('The console is not configured.');
  return { url, anonKey, serviceKey, source: production ? 'production' : 'control' };
}

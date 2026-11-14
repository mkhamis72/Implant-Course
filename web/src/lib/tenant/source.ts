import 'server-only';

export type ListSource = 'production' | 'control' | 'static';

const warned = new Set<string>();

/**
 * Where the company list comes from. `COMPANY_LIST=production` (merge release 2) reads it from the production
 * database; otherwise the control project when one is set, else TENANTS_FILE or the single company. An unknown
 * value is logged once and ignored: a typo must never take the sites down.
 */
export function listSource(env: Record<string, string | undefined> = process.env): ListSource {
  const raw = (env.COMPANY_LIST ?? '').trim();
  const value = raw.toLowerCase();
  if (value === 'production') return 'production';
  const fallback: ListSource = env.CONTROL_SUPABASE_URL ? 'control' : 'static';
  if (value && !warned.has(raw)) {
    warned.add(raw);
    console.error(`COMPANY_LIST=${raw} is not a known value; using the ${fallback === 'control' ? 'control project' : 'local company list'}`);
  }
  return fallback;
}

/**
 * Every company lives in the one database ENV_FILE points at (merge of control into production, release 3): the
 * control project and its per-company options are gone.
 */
export const TENANT_GONE = '--tenant is gone: there is one database; company:export and company:restore take --company <slug>.';
export const ONE_DATABASE = '--all-tenants / --control are gone: there is one database (ENV_FILE picks it).';

/** Throws on an option of the control era, naming its replacement; returns argv otherwise. */
export function refuseRemovedOptions(argv: string[]): string[] {
  if (argv.some((a) => a === '--tenant' || a.startsWith('--tenant='))) throw new Error(TENANT_GONE);
  if (argv.includes('--all-tenants') || argv.includes('--control')) throw new Error(ONE_DATABASE);
  return argv;
}

/** Removes `--company <slug>` from argv. */
export function takeCompanyArg(argv: string[]): { slug: string | null; rest: string[] } {
  refuseRemovedOptions(argv);
  const i = argv.indexOf('--company');
  if (i === -1) return { slug: null, rest: argv };
  const slug = argv[i + 1];
  if (!slug || slug.startsWith('--')) throw new Error('Usage: --company <slug>');
  return { slug, rest: [...argv.slice(0, i), ...argv.slice(i + 2)] };
}

type Db = { query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }> };

/** The company's id in public.companies. */
export async function companyIdBySlug(db: Db, slug: string): Promise<string> {
  const { rows } = await db.query('select id from public.companies where slug = $1', [slug]);
  const id = (rows[0] as { id?: string } | undefined)?.id;
  if (!id) throw new UnknownCompanyError(`Unknown company ${slug}`);
  return id;
}

/** An unknown company slug: the scripts exit 3 for it (the Backup workflow names the company). */
export class UnknownCompanyError extends Error {}

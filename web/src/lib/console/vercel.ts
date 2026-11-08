import 'server-only';

/**
 * Company addresses on the Vercel project (multi-tenant part 5). With VERCEL_API_TOKEN and VERCEL_PROJECT_ID
 * (VERCEL_TEAM_ID when the project is a team's) the console adds a new company's address itself; the DNS side
 * is a one-time wildcard CNAME (*.imploid.net → cname.vercel-dns.com). Without them (local, tests) the console
 * shows the manual steps instead. The token never leaves this module: errors carry Vercel's message only.
 */
type Env = Record<string, string | undefined>;
export type DomainStatus = 'live' | 'pending' | 'missing';

const API = 'https://api.vercel.com';
const TIMEOUT_MS = 10_000;

export function vercelConfigured(env: Env = process.env): boolean {
  return Boolean(env.VERCEL_API_TOKEN?.trim() && env.VERCEL_PROJECT_ID?.trim());
}

function config(env: Env) {
  if (!vercelConfigured(env)) throw new Error('Vercel is not set up for the console (VERCEL_API_TOKEN, VERCEL_PROJECT_ID).');
  const team = env.VERCEL_TEAM_ID?.trim();
  return { token: env.VERCEL_API_TOKEN!.trim(), project: encodeURIComponent(env.VERCEL_PROJECT_ID!.trim()), query: team ? `?teamId=${encodeURIComponent(team)}` : '' };
}

async function call(env: Env, path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const c = config(env);
  const res = await fetch(`${API}${path.replace('{project}', c.project)}${c.query}`, {
    ...init,
    headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

const messageOf = (body: Record<string, unknown>, status: number) =>
  ((body.error as { message?: string } | undefined)?.message ?? `HTTP ${status}`).slice(0, 200);

/** Adds the address to the project. Already on this project counts as done; on another project it fails. */
export async function addProjectDomain(host: string, env: Env = process.env): Promise<void> {
  const r = await call(env, '/v10/projects/{project}/domains', { method: 'POST', body: JSON.stringify({ name: host }) });
  if (r.status >= 200 && r.status < 300) return;
  if (r.status === 409 && (await projectDomain(host, env))) return;
  throw new Error(`Vercel did not add ${host}: ${messageOf(r.body, r.status)}`);
}

async function projectDomain(host: string, env: Env): Promise<{ verified?: boolean } | null> {
  const r = await call(env, `/v9/projects/{project}/domains/${encodeURIComponent(host)}`);
  if (r.status === 404) return null;
  if (r.status >= 300) throw new Error(`Vercel: ${messageOf(r.body, r.status)}`);
  return r.body as { verified?: boolean };
}

/** live: on the project, verified and its DNS points at Vercel. pending: added, waiting for DNS or the
 *  certificate. missing: not on the project. */
export async function domainStatus(host: string, env: Env = process.env): Promise<DomainStatus> {
  const domain = await projectDomain(host, env);
  if (!domain) return 'missing';
  if (!domain.verified) return 'pending';
  const r = await call(env, `/v6/domains/${encodeURIComponent(host)}/config`);
  if (r.status >= 300) throw new Error(`Vercel: ${messageOf(r.body, r.status)}`);
  return r.body.misconfigured ? 'pending' : 'live';
}

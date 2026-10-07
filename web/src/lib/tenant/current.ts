import 'server-only';
import { headers } from 'next/headers';
import { normaliseHost } from './host';
import { findTenantBySlug } from './registry';
import { ANY_HOST } from './static';
import { TENANT_HEADER, type Tenant } from './types';

/**
 * The company this request was routed to by the middleware. Pages, actions and route handlers only.
 * The x-tenant header is not trusted alone: the request's own Host must belong to that company.
 */
export async function currentTenant(): Promise<Tenant> {
  const h = await headers();
  const slug = h.get(TENANT_HEADER);
  const tenant = slug ? await findTenantBySlug(slug) : null;
  if (!tenant || tenant.status !== 'active') throw new Error('No company for this request');
  const host = normaliseHost(h.get('host'));
  if (!tenant.hosts.includes(ANY_HOST) && !(host && tenant.hosts.includes(host))) throw new Error('No company for this request');
  return tenant;
}

/** This request's own origin (each company has its own host), e.g. for invite links. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const raw = (h.get('host') ?? '').trim().toLowerCase();
  // normaliseHost drops the port; keep a non-default one (localhost:3000) deliberately.
  const port = raw.match(/:(\d+)$/)?.[0] ?? '';
  const name = normaliseHost(raw) ?? (/^[a-z0-9.-]+(:\d+)?$/.test(raw) ? raw.replace(/:\d+$/, '') : 'localhost');
  const host = `${name}${name === 'localhost' && !raw ? ':3000' : port}`;
  const proto = h.get('x-forwarded-proto')?.split(',')[0].trim() ?? (name.startsWith('localhost') || name.endsWith('.localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

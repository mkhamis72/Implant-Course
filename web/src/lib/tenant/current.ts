import 'server-only';
import { headers } from 'next/headers';
import { findTenantBySlug } from './registry';
import { TENANT_HEADER, type Tenant } from './types';

/** The company this request was routed to by the middleware. Pages, actions and route handlers only. */
export async function currentTenant(): Promise<Tenant> {
  const slug = (await headers()).get(TENANT_HEADER);
  const tenant = slug ? await findTenantBySlug(slug) : null;
  if (!tenant || tenant.status !== 'active') throw new Error('No company for this request');
  return tenant;
}

/** This request's own origin (each company has its own host), e.g. for invite links. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.includes('.localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

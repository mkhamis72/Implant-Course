import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { normaliseHost } from './host';
import type { Tenant } from './types';

export type StaticTenant = Tenant & { serviceRoleKey: string };
type Env = Record<string, string | undefined>;

/** The single-tenant default matches every host. */
export const ANY_HOST = '*';

const entry = z.object({
  slug: z.string().regex(/^[a-z0-9-]{2,40}$/),
  hosts: z.array(z.string()).min(1),
  supabaseUrl: z.string().url(),
  anonKey: z.string().min(1),
  serviceRoleKey: z.string().min(1),
  status: z.enum(['active', 'suspended']).default('active'),
});

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name} (see .env.example)`);
  return value;
}

/**
 * The registry without a control project. No TENANTS_FILE: today's single project, as tenant "default".
 * TENANTS_FILE (local development and isolation tests only): a list of companies, never in production.
 */
export function staticTenants(env: Env = process.env, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): StaticTenant[] {
  const path = env.TENANTS_FILE;
  if (!path) {
    return [{
      slug: 'default',
      hosts: [ANY_HOST],
      supabaseUrl: required(env, 'NEXT_PUBLIC_SUPABASE_URL'),
      anonKey: required(env, 'NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      serviceRoleKey: required(env, 'SUPABASE_SERVICE_ROLE_KEY'),
      status: 'active',
    }];
  }
  if (env.NODE_ENV === 'production') throw new Error('TENANTS_FILE is for local development only and is refused in production.');
  let content: string;
  try {
    content = read(path);
    JSON.parse(content);
  } catch (error) {
    throw new Error(`Cannot read TENANTS_FILE ${path}: ${(error as Error).message}`);
  }
  const parsed = z.array(entry).safeParse(JSON.parse(content));
  if (!parsed.success) throw new Error(`Invalid tenant in ${path}: ${parsed.error.issues[0].message}`);
  const seen = new Map<string, string>();
  return parsed.data.map((t) => {
    const hosts = t.hosts.map((h) => {
      const host = normaliseHost(h);
      if (!host) throw new Error(`Invalid tenant in ${path}: bad host ${h}`);
      const owner = seen.get(host);
      if (owner) throw new Error(`Host ${host} is listed by two tenants (${owner}, ${t.slug})`);
      seen.set(host, t.slug);
      return host;
    });
    return { ...t, hosts };
  });
}

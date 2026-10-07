import { readFileSync } from 'node:fs';
import type { ClientConfig } from 'pg';
import { isLocalHost } from './test-guard';

type Env = Record<string, string | undefined>;

/**
 * The server certificate is verified against DATABASE_CA_CERT. Only a dev project
 * (ALLOW_TEST_FIXTURES=1) may connect without one; the local stack has no TLS at all.
 */
export function pgConfig(env: Env = process.env): ClientConfig {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)');
  if (isLocalHost(new URL(connectionString).hostname)) return { connectionString, ssl: false };
  const ca = env.DATABASE_CA_CERT;
  if (ca) return { connectionString, ssl: { ca: readFileSync(ca, 'utf8') } };
  if (env.ALLOW_TEST_FIXTURES === '1') return { connectionString, ssl: { rejectUnauthorized: false } };
  throw new Error('DATABASE_CA_CERT is not set: download the CA certificate from the Supabase dashboard (see .env.example)');
}

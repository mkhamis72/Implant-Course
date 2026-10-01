import { readFileSync } from 'node:fs';
import type { ClientConfig } from 'pg';

export function pgConfig(): ClientConfig {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set (see .env.example)');
  const ca = process.env.DATABASE_CA_CERT;
  return {
    connectionString,
    ssl: ca ? { ca: readFileSync(ca, 'utf8') } : { rejectUnauthorized: false },
  };
}

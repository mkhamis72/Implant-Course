import path from 'node:path';
import type { ClientConfig } from 'pg';
import { pgConfig } from './db';
import { targetLabel } from './create-user-args';

type Env = Record<string, string | undefined>;

/** Which database and migration folder `npm run db:migrate [-- --control]` uses. */
export function migrateTarget(argv: string[], env: Env): { dir: string; config: ClientConfig; label: string } {
  if (argv.includes('--control')) {
    if (!env.CONTROL_DATABASE_URL) throw new Error('CONTROL_DATABASE_URL is not set (see .env.example)');
    return {
      dir: path.join(process.cwd(), 'supabase', 'control', 'migrations'),
      config: pgConfig({ DATABASE_URL: env.CONTROL_DATABASE_URL, DATABASE_CA_CERT: env.CONTROL_DATABASE_CA_CERT ?? env.DATABASE_CA_CERT }),
      label: `control ${targetLabel(env.CONTROL_SUPABASE_URL)}`,
    };
  }
  return { dir: path.join(process.cwd(), 'supabase', 'migrations'), config: pgConfig(env), label: targetLabel(env.NEXT_PUBLIC_SUPABASE_URL) };
}

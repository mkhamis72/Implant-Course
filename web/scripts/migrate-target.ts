import path from 'node:path';
import type { ClientConfig } from 'pg';
import { pgConfig } from './db';
import { targetLabel } from './create-user-args';
import { refuseRemovedOptions } from './one-database';

type Env = Record<string, string | undefined>;

/** The database and migration folder `npm run db:migrate` uses: the one database ENV_FILE points at. */
export function migrateTarget(argv: string[], env: Env): { dir: string; config: ClientConfig; label: string } {
  refuseRemovedOptions(argv);
  return { dir: path.join(process.cwd(), 'supabase', 'migrations'), config: pgConfig(env), label: targetLabel(env.NEXT_PUBLIC_SUPABASE_URL) };
}

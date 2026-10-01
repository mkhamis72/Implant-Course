import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import { pgConfig } from './db';

export async function migrate(
  dir = path.join(process.cwd(), 'supabase', 'migrations'),
): Promise<string[]> {
  const client = new Client(pgConfig());
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query(`
      create schema if not exists app_private;
      create table if not exists app_private.schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      );`);
    const { rows } = await client.query<{ name: string }>(
      'select name from app_private.schema_migrations',
    );
    const done = new Set(rows.map((r) => r.name));
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = readFileSync(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into app_private.schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (error) {
        await client.query('rollback');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }
  } finally {
    await client.end();
  }
  return applied;
}

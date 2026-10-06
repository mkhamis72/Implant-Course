import './load-env';
import { Client } from 'pg';
import { migrateTarget } from './migrate-target';
import { checkTenant } from './tenants';

async function main() {
  const slug = process.argv[2];
  if (!slug) throw new Error('Usage: npm run tenant:check -- <slug>');
  const target = migrateTarget(['--control'], process.env);
  console.log(`Target project: ${target.label}; company ${slug}`);
  const c = new Client(target.config);
  await c.connect();
  try {
    const t = (await c.query('select supabase_url, anon_key, status from public.tenants where slug = $1', [slug])).rows[0];
    if (!t) throw new Error(`No company ${slug} in the control project`);
    const key = (await c.query(`select decrypted_secret from vault.decrypted_secrets where name = $1`, [`tenant/${slug}/service_role_key`])).rows[0];
    if (!key) throw new Error(`No service key in Vault for ${slug}`);
    const problems = await checkTenant({ supabaseUrl: t.supabase_url, anonKey: t.anon_key, serviceRoleKey: key.decrypted_secret });
    console.log(problems.length ? `PROBLEMS for ${slug} (${t.status}):\n- ${problems.join('\n- ')}` : `${slug} (${t.status}): OK`);
    if (problems.length) process.exit(1);
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

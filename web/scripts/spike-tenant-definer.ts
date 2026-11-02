// Spike: can definers enforce company isolation through RLS by being owned by a NOBYPASSRLS role?
// Everything runs in one transaction that is always rolled back: nothing changes permanently.
//   ENV_FILE=.env.local npx tsx scripts/spike-tenant-definer.ts [--tenant <slug>]
import './load-env';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { pgConfig } from './db';
import { applyTenantArg } from './tenant-env';

/** Spec §5: public definers that stay owned by postgres. */
const STAY_POSTGRES = [
  'mfa_satisfied',
  'mfa_setup_done',
  'handle_new_user',
  'default_permissions',
  'audit_row',
  'admin_end_sessions',
  'branding_public',
  'branding_logo',
];

const COMPANY_A = randomUUID();
const COMPANY_B = randomUUID();
const ROW_A = randomUUID();

async function asAuthenticated(c: Client, sub: string, company: string, extraClaims: Record<string, unknown> = {}) {
  await c.query('reset role');
  await c.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ sub, role: 'authenticated', ...extraClaims }),
  ]);
  await c.query(`select set_config('spike.company', $1, true)`, [company]);
  await c.query('set local role authenticated');
}

async function definer(c: Client, signature: string, body: string) {
  await c.query(`create function public.${body}`);
  await c.query(`alter function public.${signature} owner to tenant_definer`);
  await c.query(`revoke execute on function public.${signature} from public, anon`);
  await c.query(`grant execute on function public.${signature} to authenticated`);
}

type Check = { name: string; run: (c: Client) => Promise<string | void> };

const checks: Check[] = [
  {
    name: '1 role tenant_definer',
    run: async (c) => {
      await c.query('create role tenant_definer nologin nobypassrls');
      await c.query('grant tenant_definer to postgres');
      await c.query('grant anon to tenant_definer');
    },
  },
  {
    name: '2 grants to tenant_definer',
    run: async (c) => {
      await c.query('grant usage on schema public, app_private to tenant_definer');
      // ALTER ... OWNER requires the new owner to have CREATE on the function's schema (anon has none here).
      // Only needed while owners change: check 8 revokes it again afterwards.
      await c.query('grant create on schema public to tenant_definer');
      await c.query('grant select, insert, update, delete on all tables in schema public to tenant_definer');
      await c.query('grant execute on all functions in schema app_private to tenant_definer');
    },
  },
  {
    name: '3 table spike_rows with forced RLS and audit trigger',
    run: async (c) => {
      await c.query('create table public.spike_rows (company_id uuid, id uuid)');
      await c.query('alter table public.spike_rows enable row level security');
      await c.query('alter table public.spike_rows force row level security');
      await c.query(`create policy spike_company on public.spike_rows as restrictive for all
        using (company_id = current_setting('spike.company')::uuid)
        with check (company_id = current_setting('spike.company')::uuid)`);
      await c.query(`create policy spike_open on public.spike_rows for all to tenant_definer, authenticated
        using (true) with check (true)`);
      await c.query(`create trigger spike_rows_audit after insert or update or delete on public.spike_rows
        for each row execute function app_private.audit_row('id')`);
      await c.query('grant select, insert, update, delete on public.spike_rows to tenant_definer');
    },
  },
  {
    name: '4 definer spike_get sees only its company',
    run: async (c) => {
      await definer(c, 'spike_get(uuid)', `spike_get(p_id uuid) returns int
        language sql stable security definer set search_path = '' as $$
          select count(*)::int from public.spike_rows where id = p_id $$`);
      await c.query(`select set_config('spike.company', $1, true)`, [COMPANY_A]);
      await c.query('insert into public.spike_rows (company_id, id) values ($1, $2)', [COMPANY_A, ROW_A]);
      const sub = randomUUID();
      await asAuthenticated(c, sub, COMPANY_B);
      const asB = (await c.query('select public.spike_get($1) as n', [ROW_A])).rows[0].n;
      await asAuthenticated(c, sub, COMPANY_A);
      const asA = (await c.query('select public.spike_get($1) as n', [ROW_A])).rows[0].n;
      await c.query('reset role');
      if (asB !== 0 || asA !== 1) throw new Error(`company B saw ${asB} (want 0), company A saw ${asA} (want 1)`);
      return 'B sees 0, A sees 1';
    },
  },
  {
    name: '5 auth.uid() inside a tenant_definer function',
    run: async (c) => {
      await definer(c, 'spike_uid()', `spike_uid() returns uuid
        language sql stable security definer set search_path = '' as $$ select auth.uid() $$`);
      const sub = randomUUID();
      await asAuthenticated(c, sub, COMPANY_A);
      const uid = (await c.query('select public.spike_uid() as u')).rows[0].u;
      await c.query('reset role');
      if (uid !== sub) throw new Error(`auth.uid() returned ${uid}, want the claims' sub`);
      return 'returns the claims sub';
    },
  },
  {
    name: '6 insert through tenant_definer, audit_row still writes',
    run: async (c) => {
      await definer(c, 'spike_insert(uuid, uuid)', `spike_insert(p_company uuid, p_id uuid) returns void
        language plpgsql security definer set search_path = '' as $$
        begin insert into public.spike_rows (company_id, id) values (p_company, p_id); end $$`);
      const id = randomUUID();
      await asAuthenticated(c, randomUUID(), COMPANY_A);
      await c.query('select public.spike_insert($1, $2)', [COMPANY_A, id]);
      await c.query('reset role');
      const n = (
        await c.query(`select count(*)::int as n from public.audit_log where table_name = 'spike_rows' and row_id = $1`, [id])
      ).rows[0].n;
      if (n !== 1) throw new Error(`${n} audit_log rows for the insert, want 1`);
      return 'row inserted, 1 audit_log row';
    },
  },
  {
    name: '7 app_private.require_active() from a tenant_definer function',
    run: async (c) => {
      await definer(c, 'spike_require_active()', `spike_require_active() returns void
        language plpgsql stable security definer set search_path = '' as $$
        begin perform app_private.require_active(); end $$`);
      const staff = (
        await c.query(`select user_id from public.profiles
          where active and role in ('admin', 'organizer') and not mfa_setup_required limit 1`)
      ).rows[0];
      if (!staff) throw new Error('no active staff profile to sign in as');
      await asAuthenticated(c, staff.user_id, COMPANY_A, { aal: 'aal2' });
      await c.query('select public.spike_require_active()');
      await c.query('reset role');
      return 'ran as an active staff user';
    },
  },
  {
    name: '8 every public definer (minus allowlist) owned by tenant_definer',
    run: async (c) => {
      const fns = (
        await c.query<{ sig: string }>(
          `select quote_ident(n.nspname) || '.' || quote_ident(p.proname)
                  || '(' || pg_get_function_identity_arguments(p.oid) || ')' as sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef
              and p.proname not like 'spike\\_%'
              and p.proname <> all($1)
              and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
            order by 1`,
          [STAY_POSTGRES],
        )
      ).rows;
      const failed: string[] = [];
      for (const { sig } of fns) {
        await c.query('savepoint fn');
        try {
          await c.query(`alter routine ${sig} owner to tenant_definer`);
          await c.query('release savepoint fn');
        } catch (e) {
          await c.query('rollback to savepoint fn');
          failed.push(`${sig}: ${(e as Error).message}`);
        }
      }
      const kept = (
        await c.query<{ n: number }>(
          `select count(*)::int as n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and p.proname = any($1)`,
          [STAY_POSTGRES],
        )
      ).rows[0].n;
      if (failed.length) throw new Error(`${failed.length} of ${fns.length} failed:\n  ${failed.join('\n  ')}`);
      await c.query('revoke create on schema public from tenant_definer');
      await asAuthenticated(c, randomUUID(), COMPANY_A);
      const n = (await c.query('select public.spike_get($1) as n', [ROW_A])).rows[0].n;
      await c.query('reset role');
      if (n !== 1) throw new Error(`after revoking CREATE, spike_get returned ${n}, want 1`);
      return `${fns.length} functions moved to tenant_definer; ${kept} allowlisted stay with postgres; CREATE on public revoked afterwards, definers still run`;
    },
  },
  {
    name: '9 pg_roles: tenant_definer has rolbypassrls = false',
    run: async (c) => {
      const r = (await c.query(`select rolbypassrls from pg_roles where rolname = 'tenant_definer'`)).rows[0];
      if (!r) throw new Error('tenant_definer not in pg_roles');
      if (r.rolbypassrls !== false) throw new Error(`rolbypassrls = ${r.rolbypassrls}`);
      return 'rolbypassrls = false';
    },
  },
];

async function main() {
  const env = process.env;
  const tenant = await applyTenantArg(process.argv.slice(2), env);
  const config = pgConfig(env);
  console.log(`Target project: ${new URL(env.DATABASE_URL!).hostname}${tenant.label ? ` (${tenant.label})` : ''}`);

  const c = new Client(config);
  await c.connect();
  let failures = 0;
  try {
    await c.query('begin');
    for (const check of checks) {
      await c.query('savepoint spike_check');
      try {
        const detail = await check.run(c);
        await c.query('release savepoint spike_check');
        console.log(`PASS ${check.name}${detail ? `: ${detail}` : ''}`);
      } catch (e) {
        failures++;
        await c.query('rollback to savepoint spike_check');
        console.log(`FAIL ${check.name}: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query('rollback').catch(() => {});
    try {
      const left = (await c.query(`select count(*)::int as n from pg_roles where rolname = 'tenant_definer'`)).rows[0].n;
      console.log(`After rollback: tenant_definer ${left ? 'STILL EXISTS' : 'is gone'}`);
      if (left) failures++;
    } finally {
      await c.end();
    }
  }
  console.log(failures ? `${failures} check(s) failed` : 'All checks passed');
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});

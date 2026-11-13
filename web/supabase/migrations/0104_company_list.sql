set local lock_timeout = '5s';

-- Merge of the control project into this database, release 1 (docs/superpowers/specs/
-- 2026-11-14-merge-control-into-production-design.md). The company list moves here: each company's addresses
-- and its status, with the rules of the control project's tenants table (control 0001, tenants_normalise),
-- and a change log in place of control's tenant_audit. Nothing in the app reads these yet: it still routes
-- through the control project, and list:copy fills them from there (scripts/list-sync.ts).

alter table public.companies
  add column hosts text[] not null default '{}',
  add column status text not null default 'active' check (status in ('active', 'suspended')),
  add column list_updated_at timestamptz not null default now();

-- Who changed a company's place in the list and why. app.actor / app.reason are set per transaction by the
-- console functions (0105); source_id is the control row a copied entry came from (list:copy runs again safely).
create table public.company_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  slug text not null,
  action text not null,
  actor text not null default current_user,
  reason text,
  before jsonb,
  after jsonb,
  source_id bigint unique
);
-- Closed to company users; the service role reads and adds entries; tenant_definer gets the same policy as on
-- every other table (0092).
alter table public.company_log enable row level security;
alter table public.company_log force row level security;
create policy company_log_tenant_definer on public.company_log for all to tenant_definer using (true) with check (true);
revoke all on public.company_log from public, anon, authenticated, service_role;
grant select, insert on public.company_log to service_role;

-- Addresses are cleaned (lower case, no port, no trailing dot) and belong to one company. Compared by id, not
-- slug, so a company can change its slug and keep its addresses (control's trigger refused that).
-- Definer, owned by postgres (scripts/definer-allowlist.ts): companies has forced row-level security, and the
-- check must see every company's addresses whoever writes the row.
create function app_private.companies_list_normalise() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_host text;
  v_owner text;
begin
  new.hosts := array(select distinct regexp_replace(regexp_replace(lower(trim(h)), ':\d+$', ''), '\.$', '') from unnest(new.hosts) h);
  foreach v_host in array new.hosts loop
    if v_host is null or v_host !~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$' then
      raise exception 'Invalid host: %', coalesce(v_host, 'null');
    end if;
  end loop;
  if cardinality(new.hosts) > 0 then
    perform pg_advisory_xact_lock(hashtext('public.companies.hosts'));
    select c.slug into v_owner from public.companies c where c.id <> new.id and c.hosts && new.hosts limit 1;
    if v_owner is not null then
      raise exception 'A host of % is already used by %', new.slug, v_owner;
    end if;
  end if;
  if tg_op = 'INSERT' or (new.slug, new.name, new.hosts, new.status) is distinct from (old.slug, old.name, old.hosts, old.status) then
    new.list_updated_at := now();
  end if;
  return new;
end $$;
alter function app_private.companies_list_normalise() owner to postgres;
revoke all on function app_private.companies_list_normalise() from public, anon, authenticated, tenant_definer;
create trigger companies_list_normalise before insert or update on public.companies
  for each row execute function app_private.companies_list_normalise();

-- The list's own log (the per-company audit_log keeps recording every change, as before). list:copy sets
-- app.list_copy so copying writes no entries of its own: it copies control's entries instead.
create function app_private.companies_list_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb := case when tg_op <> 'INSERT' then jsonb_build_object('slug', old.slug, 'name', old.name, 'hosts', to_jsonb(old.hosts), 'status', old.status) end;
  v_after jsonb := case when tg_op <> 'DELETE' then jsonb_build_object('slug', new.slug, 'name', new.name, 'hosts', to_jsonb(new.hosts), 'status', new.status) end;
begin
  if coalesce(current_setting('app.list_copy', true), '') = 'on' or v_before is not distinct from v_after then
    return null;
  end if;
  insert into public.company_log (slug, action, actor, reason, before, after)
  values (coalesce(new.slug, old.slug), lower(tg_op),
          coalesce(nullif(current_setting('app.actor', true), ''), current_user),
          nullif(current_setting('app.reason', true), ''),
          v_before, v_after);
  return null;
end $$;
alter function app_private.companies_list_audit() owner to postgres;
revoke all on function app_private.companies_list_audit() from public, anon, authenticated, tenant_definer;
create trigger companies_list_audit after insert or update or delete on public.companies
  for each row execute function app_private.companies_list_audit();

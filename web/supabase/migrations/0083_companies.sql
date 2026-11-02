-- One database (plan 1): the companies table and the `app` helper schema. Additive only: nothing
-- reads these yet, and academy (the one company) sees no change. `app` is not exposed by PostgREST;
-- it holds the session helpers that later policies call. Only `app` may call auth.uid()/auth.jwt()
-- in new SQL; everything else goes through app.current_user_id() / app.current_aal().
create schema app;
revoke all on schema app from public;
grant usage on schema app to authenticated, anon;

create function app.current_user_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select auth.uid()
$$;

create function app.current_aal() returns text
language sql stable security definer set search_path = '' as $$
  select auth.jwt() ->> 'aal'
$$;

-- No session is bound to a company yet; 0085 replaces this.
create function app.current_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select null::uuid
$$;

alter function app.current_user_id() owner to postgres;
alter function app.current_aal() owner to postgres;
alter function app.current_company_id() owner to postgres;
revoke all on function app.current_user_id(), app.current_aal(), app.current_company_id() from public;
grant execute on function app.current_user_id(), app.current_aal(), app.current_company_id() to authenticated, anon;

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);
insert into public.companies (id, slug, name) values (
  'a7c0de00-0000-4000-8000-000000000001', 'academy',
  coalesce((select nullif(trim(b.name), '') from public.branding b where b.id), 'Academy')
);

alter table public.companies enable row level security;
alter table public.companies force row level security;
revoke all on public.companies from public, anon, authenticated;
grant select on public.companies to authenticated;
create policy companies_select_own on public.companies for select to authenticated
  using (id = (select app.current_company_id()));

create trigger companies_audit after insert or update or delete on public.companies
  for each row execute function app_private.audit_row('id');

-- Every table that holds one company's rows: all ordinary tables in public except the company list
-- itself and profiles, plus app_private.research_codes.
create function app.company_tables() returns setof regclass
language sql stable set search_path = '' as $$
  select c.oid::regclass from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and c.relname not in ('companies', 'profiles')
  union all
  select 'app_private.research_codes'::regclass
$$;
revoke all on function app.company_tables() from public, anon, authenticated;

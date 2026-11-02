-- One database (plan 1): company_id on every company table. Additive only: existing rows get academy
-- through the constant default (no UPDATE, no table rewrite, so no row trigger fires: the append-only
-- stock_movements and audit_log stay untouched), and every insert the previous app version makes gets
-- academy the same way. Plan 3 relies on the names: <table>_company_id_idx, <table>_company_id_key
-- (unique (company_id, id) where the primary key is the single column id; unique (company_id) on the
-- singletons settings, branding and branding_logos; none on tables with any other primary key).
-- Re-runnable: every step skips what already exists.
set local lock_timeout = '5s';

do $$
declare
  t regclass;
  rel text;
  nsp text;
  key_cols text;
begin
  for t in select * from app.company_tables() loop
    select c.relname, n.nspname into rel, nsp
    from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where c.oid = t;
    if length(rel || '_company_id_fkey') > 63 then
      raise exception 'company_id constraint names for % would be truncated', rel;
    end if;

    execute format(
      'alter table %s add column if not exists company_id uuid not null default %L',
      t, 'a7c0de00-0000-4000-8000-000000000001');

    if not exists (select 1 from pg_catalog.pg_constraint
                   where conrelid = t and conname = rel || '_company_id_fkey') then
      execute format('alter table %s add constraint %I foreign key (company_id) references public.companies (id)',
                     t, rel || '_company_id_fkey');
    end if;

    execute format('create index if not exists %I on %s (company_id)', rel || '_company_id_idx', t);

    key_cols := case
      when nsp = 'public' and rel in ('settings', 'branding', 'branding_logos') then 'company_id'
      when (select array_agg(a.attname::text)
            from pg_catalog.pg_constraint p
            join pg_catalog.pg_attribute a on a.attrelid = p.conrelid and a.attnum = any (p.conkey)
            where p.conrelid = t and p.contype = 'p') = array['id'] then 'company_id, id'
    end;
    if key_cols is not null and not exists (select 1 from pg_catalog.pg_constraint
                                            where conrelid = t and conname = rel || '_company_id_key') then
      execute format('alter table %s add constraint %I unique (%s)', t, rel || '_company_id_key', key_cols);
    end if;
  end loop;
end $$;

create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  row_id text,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  user_id uuid,
  at timestamptz not null default now(),
  before jsonb,
  after jsonb
);
create index audit_log_table_row_idx on public.audit_log (table_name, row_id);

alter table public.audit_log enable row level security;
revoke all on public.audit_log from anon;
revoke insert, update, delete, truncate on public.audit_log from authenticated;
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_active_user());

create function app_private.audit_immutable() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end $$;

create trigger audit_log_no_change before update or delete on public.audit_log
  for each row execute function app_private.audit_immutable();
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function app_private.audit_immutable();

-- Usage: execute function app_private.audit_row('<primary key column>')
create function app_private.audit_row() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then v_before := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_after := to_jsonb(new); end if;
  insert into public.audit_log (table_name, row_id, action, user_id, before, after)
  values (
    tg_table_name,
    coalesce(v_after, v_before) ->> tg_argv[0],
    tg_op,
    auth.uid(),
    v_before,
    v_after
  );
  return coalesce(new, old);
end $$;

create trigger profiles_audit after insert or update or delete on public.profiles
  for each row execute function app_private.audit_row('user_id');
create trigger settings_audit after insert or update or delete on public.settings
  for each row execute function app_private.audit_row('id');

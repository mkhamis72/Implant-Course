create table public.delegates (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  phone text not null default '' check (length(phone) <= 40),
  email text not null default '' check (length(email) <= 120),
  licence_no text not null default '' check (length(licence_no) <= 60),
  notes text not null default '' check (length(notes) <= 1000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger delegates_set_updated_at before update on public.delegates
  for each row execute function app_private.set_updated_at();
create trigger delegates_audit after insert or update or delete on public.delegates
  for each row execute function app_private.audit_row('id');

revoke all on public.delegates from anon;
revoke insert, update, delete, truncate on public.delegates from authenticated;
grant insert (full_name, phone, email, licence_no, notes, active) on public.delegates to authenticated;
grant update (full_name, phone, email, licence_no, notes, active) on public.delegates to authenticated;

alter table public.delegates enable row level security;
create policy delegates_select on public.delegates for select to authenticated using (public.is_active_user());
create policy delegates_insert on public.delegates for insert to authenticated with check (public.is_active_user());
create policy delegates_update on public.delegates for update to authenticated
  using (public.is_active_user()) with check (public.is_active_user());

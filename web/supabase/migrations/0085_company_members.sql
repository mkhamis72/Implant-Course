-- One database (plan 1): company memberships and session binding. Additive only: nothing reads these
-- yet. profiles stays the source the previous app version writes; a trigger mirrors role, active,
-- delegate link and the 2FA setup flag into academy's company_members row (spec §4). The company-aware
-- release turns this round; the cleanup release drops the profiles columns and this trigger.
set local lock_timeout = '5s';


-- company_members: one row per login per company. company_id has no default: every row names its
-- company (0084's academy default is for the tables the previous app version writes without one).
create table public.company_members (
  company_id uuid not null references public.companies (id),
  user_id uuid not null references public.profiles (user_id) on delete cascade,
  role public.user_role not null,
  active boolean not null,
  delegate_id uuid,
  mfa_setup_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, user_id),
  foreign key (company_id, delegate_id) references public.delegates (company_id, id),
  unique (company_id, delegate_id)
);
create index company_members_user_id_idx on public.company_members (user_id);

alter table public.company_members enable row level security;
alter table public.company_members force row level security;
revoke all on public.company_members from public, anon, authenticated;
grant select on public.company_members to authenticated;
create policy company_members_select on public.company_members for select to authenticated
  using (user_id = (select app.current_user_id()) or (select public.is_admin()));

create trigger company_members_set_updated_at before update on public.company_members
  for each row execute function app_private.set_updated_at();
create trigger company_members_audit after insert or update or delete on public.company_members
  for each row execute function app_private.audit_row('user_id');

-- session_companies: which company a sign-in session belongs to (spec §3). Closed to every API role;
-- only app.bind_session writes it and app.current_company_id reads it.
create table app.session_companies (
  session_id uuid primary key,
  company_id uuid not null references public.companies (id),
  user_id uuid not null,
  created_at timestamptz not null default now()
);
alter table app.session_companies enable row level security;
alter table app.session_companies force row level security;
revoke all on app.session_companies from public, anon, authenticated;

-- Replaces 0083's stub; same signature, so its grants stay. Null for an unbound session, or when the
-- session id is carried by a different user.
create or replace function app.current_company_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select company_id from app.session_companies
  where session_id = nullif(auth.jwt() ->> 'session_id', '')::uuid and user_id = auth.uid()
$$;

-- bind_session: called by the server after a successful sign-in. Needs an active membership of any
-- role (delegate logins sign in too). A session belongs to one company for life.
create function app.bind_session(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  v_user uuid := auth.uid();
  v_bound app.session_companies;
begin
  if v_session is null or v_user is null then
    perform app_private.fail('No sign-in session.');
  end if;
  if not exists (select 1 from public.company_members m
                 where m.company_id = p_company and m.user_id = v_user and m.active) then
    perform app_private.fail('You do not have access to this company.');
  end if;
  insert into app.session_companies (session_id, company_id, user_id)
  values (v_session, p_company, v_user)
  on conflict (session_id) do nothing;
  select * into v_bound from app.session_companies where session_id = v_session;
  if v_bound.company_id <> p_company or v_bound.user_id <> v_user then
    perform app_private.fail('You do not have access to this company.');
  end if;
end $$;
alter function app.bind_session(uuid) owner to postgres;
revoke all on function app.bind_session(uuid) from public, anon;
grant execute on function app.bind_session(uuid) to authenticated;

-- sync_member_from_profile: the previous app version writes role, active, delegate_id and
-- mfa_setup_required on profiles; keep academy's member row in step. Depth 1 is a direct write to
-- profiles, depth 2 the insert handle_new_user makes from auth.users (so < 2 would miss new logins);
-- anything deeper is a write-back from another trigger and is skipped. The upsert also skips rows that
-- already match, so a mirror in the other direction (company-aware release) can't ping-pong.
-- On delete the profiles FK cascade has usually removed the row already; deleting nothing is fine.
create function app_private.sync_member_from_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if pg_trigger_depth() < 3 then
    if tg_op = 'DELETE' then
      delete from public.company_members
      where company_id = 'a7c0de00-0000-4000-8000-000000000001' and user_id = old.user_id;
    else
      insert into public.company_members as m (company_id, user_id, role, active, delegate_id, mfa_setup_required)
      values ('a7c0de00-0000-4000-8000-000000000001', new.user_id, new.role, new.active, new.delegate_id, new.mfa_setup_required)
      on conflict (company_id, user_id) do update
        set role = excluded.role, active = excluded.active, delegate_id = excluded.delegate_id,
            mfa_setup_required = excluded.mfa_setup_required
        where (m.role, m.active, m.delegate_id, m.mfa_setup_required)
          is distinct from (excluded.role, excluded.active, excluded.delegate_id, excluded.mfa_setup_required);
    end if;
  end if;
  return null;
end $$;
revoke all on function app_private.sync_member_from_profile() from public, anon, authenticated;

create trigger profiles_sync_member after insert or update or delete on public.profiles
  for each row execute function app_private.sync_member_from_profile();

insert into public.company_members (company_id, user_id, role, active, delegate_id, mfa_setup_required)
select 'a7c0de00-0000-4000-8000-000000000001', p.user_id, p.role, p.active, p.delegate_id, p.mfa_setup_required
from public.profiles p;

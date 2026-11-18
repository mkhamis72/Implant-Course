-- Modules, release 3, review fix: the admin user tools work in every plan. They started with
-- require_perm('delegates', 'edit') as a stand-in, and since 0109 can('delegates') also needs module_on('teaching'),
-- so in a Clinic an admin could not change a user's email or name, reset 2FA, end sessions, record events or read
-- the history. The real gate was always the admin check (admin_company / is_admin); require_active() keeps the
-- active-staff and 2FA (aal2) requirement that require_perm brought. Recreated from their latest definitions
-- (0090, 0092, 0103) with the same signatures. admin_change_email updates a delegate's email only while
-- teaching is on (in a clinic the delegates table is closed).
set local lock_timeout = '5s';

create or replace function public.admin_change_email(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_delegate uuid;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if p_user = app.current_user_id() then
    perform app_private.fail('You can''t do this to your own account here. Use Account → Security.');
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    perform app_private.fail('Enter a valid email address.');
  end if;
  if length(v_email) > 120 then
    perform app_private.fail('Keep the email to 120 characters or fewer.');
  end if;
  select m.delegate_id into v_delegate from public.company_members m
  where m.company_id = v_company and m.user_id = p_user;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  if app.member_elsewhere(p_user, v_company) then
    perform app_private.fail('This user also belongs to another company. Ask support to change their sign-in details.');
  end if;
  perform 1 from public.profiles where user_id = p_user for update;
  if exists (select 1 from public.profiles where lower(email) = v_email and user_id <> p_user) then
    perform app_private.fail('Another account already uses that email.');
  end if;
  update public.profiles set email = v_email where user_id = p_user;
  if v_delegate is not null and public.module_on('teaching') then
    update public.delegates set email = v_email where company_id = v_company and id = v_delegate;
  end if;
end $$;

create or replace function public.admin_end_sessions(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  v_company := app_private.admin_company('Only an admin can do this.', false);
  delete from self_auth.session s
  where s."userId" = p_user
    and s.id in (select sc.session_id from app.session_companies sc
                 where sc.company_id = v_company and sc.user_id = p_user);
end $$;

create or replace function public.admin_record_event(p_user uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if p_kind is null or p_kind not in ('invite_resent', 'email_change_incomplete') then
    perform app_private.fail('Unknown event.');
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_user) then
    perform app_private.fail('User not found.');
  end if;
  insert into public.admin_events (company_id, user_id, kind, actor_id)
  values (v_company, p_user, p_kind, app.current_user_id());
end $$;

create or replace function public.admin_require_mfa_setup(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_active();
  if not public.is_admin() then
    perform app_private.fail('Only an admin can do this.');
  end if;
  if p_user = app.current_user_id() then
    perform app_private.fail('You can''t do this to your own account here. Use Account → Security.');
  end if;
  v_company := app_private.admin_company('Only an admin can do this.', false);
  update public.company_members set mfa_setup_required = true where company_id = v_company and user_id = p_user;
  if not found then
    perform app_private.fail('User not found.');
  end if;
  insert into public.admin_events (company_id, user_id, kind, actor_id)
  values (v_company, p_user, 'mfa_reset', app.current_user_id());
end $$;

create or replace function public.admin_set_name(p_user uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if v_name = '' then
    perform app_private.fail('Enter a name.');
  end if;
  if length(v_name) > 120 then
    perform app_private.fail('Keep the name to 120 characters or fewer.');
  end if;
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_user) then
    perform app_private.fail('User not found.');
  end if;
  if app.member_elsewhere(p_user, v_company) then
    perform app_private.fail('This user also belongs to another company. Ask support to change their sign-in details.');
  end if;
  update public.profiles set full_name = v_name where user_id = p_user;
end $$;

create or replace function public.admin_user_history(p_user uuid)
returns table (at timestamptz, actor_name text, kind text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can do this.', false);
  if not exists (select 1 from public.company_members m where m.company_id = v_company and m.user_id = p_user) then
    perform app_private.fail('User not found.');
  end if;
  return query
  with entries as (
    select a.at, a.user_id as actor_id, 'email_changed'::text as kind
    from public.audit_log a
    where a.company_id = v_company and a.table_name = 'profiles' and a.row_id = p_user::text and a.action = 'UPDATE'
      and coalesce(a.before ->> 'email', '') <> ''
      and a.before ->> 'email' is distinct from a.after ->> 'email'
    union all
    select a.at, a.user_id, 'name_changed'
    from public.audit_log a
    where a.company_id = v_company and a.table_name = 'profiles' and a.row_id = p_user::text and a.action = 'UPDATE'
      and coalesce(a.before ->> 'full_name', '') <> ''
      and a.before ->> 'full_name' is distinct from a.after ->> 'full_name'
    union all
    select e.at, e.actor_id, e.kind from public.admin_events e where e.company_id = v_company and e.user_id = p_user
  )
  select en.at, coalesce(nullif(p.full_name, ''), p.email), en.kind
  from entries en left join public.profiles p on p.user_id = en.actor_id
  order by en.at desc, en.kind
  limit 10;
end $$;

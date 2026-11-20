-- Clinic workflow (docs/superpowers/specs/2026-11-18-clinic-workflow-design.md): a doctor's sign-in is linked to the Doctors list
-- (0114). An admin invites a doctor (a new one, or one from the list) with the login, or links and unlinks a login
-- later; an admin may also be a doctor. A clinic's new organizers (its doctors) get Edit on the clinic's areas.
-- Additive: create_pending_login / add_existing_member keep working for the previous app version; the _v2 versions
-- take the doctor. handle_new_self_auth_user (0105), cancel_pending_login (0088) and default_permissions (0090) are
-- recreated from their latest definitions with the same signatures (owners and grants stay).
set local lock_timeout = '5s';

-- ── The link ────────────────────────────────────────────────────────────────────────────────────────
-- A doctor's login is a member of the doctor's own company (company_members' key is (company_id, user_id)).
-- Removing the membership (delete_user) unlinks the doctor rather than refusing: the doctor stays in the list.
-- One doctor per login in a company; the unique index also serves the foreign key (fk-indexes test).
-- authenticated gets no column grant on user_id: only set_doctor_login and the invites write it.
alter table public.doctors add column user_id uuid,
  add constraint doctors_user_id_fkey foreign key (company_id, user_id)
    references public.company_members (company_id, user_id) on delete set null (user_id);
create unique index doctors_user_id_key on public.doctors (company_id, user_id) where user_id is not null;

-- The doctor a pending login links to on sign-up; doctor_created: made for this invite, so a cancel removes it.
alter table app_private.pending_logins add column doctor_id uuid,
  add column doctor_created boolean not null default false,
  add constraint pending_logins_doctor_id_fkey foreign key (company_id, doctor_id)
    references public.doctors (company_id, id) on delete set null (doctor_id);
create index pending_logins_doctor_id_idx on app_private.pending_logins (company_id, doctor_id);

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────
-- The doctor an invite links to, for the company: a new one named p_name, or p_doctor (active, without a login
-- and not already promised to another pending login). Returns null when neither is asked for.
create function app_private.invite_doctor(
  p_company uuid, p_role public.user_role, p_doctor uuid, p_new_doctor boolean, p_name text, p_email text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if p_doctor is not null and coalesce(p_new_doctor, false) then
    perform app_private.fail('Choose one doctor.');
  end if;
  if p_doctor is null and not coalesce(p_new_doctor, false) then
    return null;
  end if;
  if p_role not in ('admin', 'organizer') then
    perform app_private.fail('Invalid request.');
  end if;
  if p_doctor is not null then
    if not exists (select 1 from public.doctors d
                   where d.company_id = p_company and d.id = p_doctor and d.active and d.user_id is null)
       or exists (select 1 from app_private.pending_logins pl
                  where pl.company_id = p_company and pl.doctor_id = p_doctor and pl.email <> p_email) then
      perform app_private.fail('Choose a doctor without a login.');
    end if;
    return p_doctor;
  end if;
  if length(v_name) not between 2 and 120 then
    perform app_private.fail('Enter the doctor''s name (2–120 characters).');
  end if;
  insert into public.doctors (company_id, name) values (p_company, v_name) returning id into v_id;
  return v_id;
end $$;

-- Deletes a doctor made for an invite, while nothing names it: no login, no implant or booking (the foreign keys
-- to public.doctors: implant_sites.placing_doctor_id and surgery_slots.placing_doctor_id, 0114).
create function app_private.drop_invite_doctor(p_company uuid, p_doctor uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_doctor is null
     or exists (select 1 from public.implant_sites s where s.company_id = p_company and s.placing_doctor_id = p_doctor)
     or exists (select 1 from public.surgery_slots s where s.company_id = p_company and s.placing_doctor_id = p_doctor) then
    return;
  end if;
  begin
    delete from public.doctors where company_id = p_company and id = p_doctor and user_id is null;
  exception when foreign_key_violation then
    null; -- named by a table added later: keep it
  end;
end $$;

-- ── Invites ─────────────────────────────────────────────────────────────────────────────────────────
-- 0117's create_pending_login, plus the doctor. A repeat replaces the row; a doctor the replaced row made and
-- the new one doesn't use is removed again.
create function public.create_pending_login_v2(
  p_email text, p_full_name text, p_role public.user_role, p_delegate_id uuid, p_doctor uuid, p_new_doctor boolean
) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_old record;
  v_doctor uuid;
begin
  if v_email = '' then
    perform app_private.fail('Invalid request.');
  end if;
  if (p_role = 'delegate' or p_delegate_id is not null) and not public.module_on('teaching') then
    perform app_private.fail('Delegate logins are not used in your plan.');
  end if;
  perform app_private.check_login_role(p_role, p_delegate_id);
  if p_delegate_id is not null
     and not exists (select 1 from public.delegates d where d.company_id = v_company and d.id = p_delegate_id) then
    perform app_private.fail('Delegate not found.');
  end if;
  select pl.doctor_id, pl.doctor_created into v_old from app_private.pending_logins pl
  where pl.company_id = v_company and pl.email = v_email for update;
  v_doctor := app_private.invite_doctor(v_company, p_role, p_doctor, p_new_doctor, p_full_name, v_email);
  insert into app_private.pending_logins (company_id, email, full_name, role, delegate_id, created_by, doctor_id, doctor_created)
  values (v_company, v_email, coalesce(trim(p_full_name), ''), p_role, p_delegate_id, app.current_user_id(),
          v_doctor, coalesce(p_new_doctor, false) and v_doctor is not null)
  on conflict (company_id, email) do update
    set full_name = excluded.full_name, role = excluded.role, delegate_id = excluded.delegate_id,
        created_by = excluded.created_by, created_at = now(),
        doctor_id = excluded.doctor_id, doctor_created = excluded.doctor_created;
  if v_old.doctor_created and v_old.doctor_id is distinct from v_doctor then
    perform app_private.drop_invite_doctor(v_company, v_old.doctor_id);
  end if;
end $$;

-- 0117's add_existing_member, plus the doctor, linked at once (the account exists). A new doctor takes the
-- person's name.
create function public.add_existing_member_v2(
  p_email text, p_role public.user_role, p_delegate_id uuid, p_doctor uuid, p_new_doctor boolean
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
  v_user uuid;
  v_name text;
  v_doctor uuid;
begin
  if (p_role = 'delegate' or p_delegate_id is not null) and not public.module_on('teaching') then
    perform app_private.fail('Delegate logins are not used in your plan.');
  end if;
  perform app_private.check_login_role(p_role, p_delegate_id);
  select p.user_id, left(coalesce(nullif(btrim(p.full_name), ''), p.email), 120) into v_user, v_name
  from public.profiles p where p.email = lower(trim(coalesce(p_email, ''))) limit 1;
  if v_user is null then
    perform app_private.fail('User not found.');
  end if;
  if p_delegate_id is not null
     and not exists (select 1 from public.delegates d where d.company_id = v_company and d.id = p_delegate_id) then
    perform app_private.fail('Delegate not found.');
  end if;
  begin
    insert into public.company_members (company_id, user_id, role, active, delegate_id)
    values (v_company, v_user, p_role, true, p_delegate_id)
    on conflict (company_id, user_id) do nothing;
  exception when unique_violation then
    -- (company_id, delegate_id): one login per delegate in a company.
    perform app_private.fail('This delegate already has a login.');
  end;
  if not found then
    perform app_private.fail('A user with this email already exists.');
  end if;
  v_doctor := app_private.invite_doctor(v_company, p_role, p_doctor, p_new_doctor, v_name, '');
  if v_doctor is not null then
    update public.doctors set user_id = v_user where company_id = v_company and id = v_doctor;
  end if;
  return v_user;
end $$;

-- 0088's cancel_pending_login, plus: a doctor made for this invite goes too, while nothing names it.
create or replace function public.cancel_pending_login(p_email text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid := app_private.admin_company('Only admins can do this.', false);
  v_doctor uuid;
  v_created boolean;
begin
  delete from app_private.pending_logins
  where company_id = v_company and email = lower(trim(coalesce(p_email, '')))
  returning doctor_id, doctor_created into v_doctor, v_created;
  if v_created then
    perform app_private.drop_invite_doctor(v_company, v_doctor);
  end if;
end $$;

-- ── Linking later ───────────────────────────────────────────────────────────────────────────────────
-- Admin only, in every plan (as 0118). p_user null unlinks; a login is an active admin or organizer of this
-- company and links one doctor at most.
create function public.set_doctor_login(p_doctor uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_company uuid;
begin
  perform app_private.require_active();
  v_company := app_private.admin_company('Only an admin can do this.', false);
  perform 1 from public.doctors d where d.company_id = v_company and d.id = p_doctor for update;
  if not found then
    perform app_private.fail('Doctor not found.');
  end if;
  if p_user is not null then
    if not exists (select 1 from public.company_members m
                   where m.company_id = v_company and m.user_id = p_user and m.active
                     and m.role in ('admin', 'organizer')) then
      perform app_private.fail('User not found.');
    end if;
    if exists (select 1 from public.doctors d
               where d.company_id = v_company and d.user_id = p_user and d.id <> p_doctor) then
      perform app_private.fail('That login is already linked to a doctor.');
    end if;
  end if;
  update public.doctors set user_id = p_user where company_id = v_company and id = p_doctor;
end $$;

-- ── Sign-up ─────────────────────────────────────────────────────────────────────────────────────────
-- 0105's body, plus: the pending row's doctor is linked to the new membership (if it is still unlinked).
create or replace function app_private.handle_new_self_auth_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(new."realEmail");
  v_name text;
begin
  if new."companyId" = 'console' then
    return new;
  end if;
  if exists (select 1 from public.profiles p where p.user_id = new.id) then
    return new;
  end if;
  delete from app_private.pending_logins where email = v_email and created_at < now() - interval '7 days';
  select pl.full_name into v_name from app_private.pending_logins pl
  where pl.email = v_email and pl.company_id::text = new."companyId" order by pl.created_at desc limit 1;
  if not found then
    perform app_private.fail('No pending login for this address.');
  end if;
  insert into public.profiles (user_id, email, full_name) values (new.id, v_email, v_name);
  insert into public.company_members (company_id, user_id, role, active, delegate_id)
  select pl.company_id, new.id, pl.role, true, pl.delegate_id
  from app_private.pending_logins pl
  where pl.email = v_email and pl.company_id::text = new."companyId"
    and (pl.delegate_id is null
         or exists (select 1 from public.delegates d where d.company_id = pl.company_id and d.id = pl.delegate_id))
  on conflict do nothing;
  update public.doctors d set user_id = new.id
  from app_private.pending_logins pl
  where pl.email = v_email and pl.company_id::text = new."companyId"
    and d.company_id = pl.company_id and d.id = pl.doctor_id and d.user_id is null
    and exists (select 1 from public.company_members m where m.company_id = pl.company_id and m.user_id = new.id);
  delete from app_private.pending_logins where email = v_email and company_id::text = new."companyId";
  return new;
end $$;

-- ── Default permissions ─────────────────────────────────────────────────────────────────────────────
-- 0090's body, plus: a clinic's new organizer (one of its doctors) gets Edit on the clinic's areas. A course
-- organizer's organizers keep View everywhere. Existing rows are untouched (only a member without any).
create or replace function app_private.default_permissions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.role is not distinct from new.role then
    return new;
  end if;
  if new.role = 'organizer' and not exists (
    select 1 from public.user_permissions where company_id = new.company_id and user_id = new.user_id
  ) then
    if 'teaching' <> all(app_private.company_features(new.company_id)) then
      insert into public.user_permissions (company_id, user_id, area, level)
      select new.company_id, new.user_id, a.area, 'edit'
      from (values ('patients'), ('schedule'), ('checklists'), ('inventory'), ('research')) as a (area);
    else
      insert into public.user_permissions (company_id, user_id, area, level)
      select new.company_id, new.user_id, a.area, 'view'
      from (values ('patients'), ('schedule'), ('courses'), ('checklists'), ('inventory'), ('delegates')) as a (area);
    end if;
  end if;
  return new;
end $$;

-- ── Owner and grants ─────────────────────────────────────────────────────────────────────────────────
-- Definers belong to tenant_definer (0092; scripts/migrate.ts checks it), as in 0122. handle_new_self_auth_user
-- and default_permissions stay postgres-owned (scripts/definer-allowlist.ts).
grant create on schema public, app_private to tenant_definer;
alter function app_private.invite_doctor(uuid, public.user_role, uuid, boolean, text, text) owner to tenant_definer;
alter function app_private.drop_invite_doctor(uuid, uuid) owner to tenant_definer;
alter function public.create_pending_login_v2(text, text, public.user_role, uuid, uuid, boolean) owner to tenant_definer;
alter function public.add_existing_member_v2(text, public.user_role, uuid, uuid, boolean) owner to tenant_definer;
alter function public.set_doctor_login(uuid, uuid) owner to tenant_definer;
revoke create on schema public, app_private from tenant_definer;

revoke execute on function app_private.invite_doctor(uuid, public.user_role, uuid, boolean, text, text),
  app_private.drop_invite_doctor(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.create_pending_login_v2(text, text, public.user_role, uuid, uuid, boolean),
  public.add_existing_member_v2(text, public.user_role, uuid, uuid, boolean),
  public.set_doctor_login(uuid, uuid) from public, anon;
grant execute on function public.create_pending_login_v2(text, text, public.user_role, uuid, uuid, boolean),
  public.add_existing_member_v2(text, public.user_role, uuid, uuid, boolean),
  public.set_doctor_login(uuid, uuid) to authenticated;

set local lock_timeout = '5s';

-- console_add_first_admin, per company. Accounts are per company: an address that only has an account at ANOTHER
-- company is a new person here, so it gets the pending admin login (the new account's trigger turns it into the
-- membership). 0093 looked the address up across all companies and gave the other company's account a membership.
-- The address counts as an existing account only when it belongs to p_company: a Self-Auth user of that company
-- with that real email, or (Supabase-era rows, for the rollback window) a profile that already has a membership
-- in that company. Owner, grants and the definer allowlist entry are unchanged (create or replace keeps them).
create or replace function public.console_add_first_admin(p_company uuid, p_email text, p_full_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_user uuid;
begin
  if v_email = '' then
    perform app_private.fail('Invalid request.');
  end if;
  if not exists (select 1 from public.companies c where c.id = p_company) then
    perform app_private.fail('Unknown company.');
  end if;
  select u.id into v_user from self_auth."user" u
  where u."companyId" = p_company::text and lower(u."realEmail") = v_email limit 1;
  if v_user is null then
    select p.user_id into v_user from public.profiles p
    where p.email = v_email
      and exists (select 1 from public.company_members m where m.user_id = p.user_id and m.company_id = p_company)
    limit 1;
  end if;
  if v_user is null then
    insert into app_private.pending_logins (company_id, email, full_name, role, delegate_id, created_by)
    values (p_company, v_email, coalesce(trim(p_full_name), ''), 'admin', null, '00000000-0000-0000-0000-000000000000')
    on conflict (company_id, email) do update
      set full_name = excluded.full_name, role = excluded.role, delegate_id = excluded.delegate_id,
          created_by = excluded.created_by, created_at = now();
  else
    insert into public.company_members (company_id, user_id, role, active, delegate_id)
    values (p_company, v_user, 'admin', true, null)
    on conflict (company_id, user_id) do update
      set role = excluded.role, active = excluded.active, delegate_id = excluded.delegate_id;
  end if;
end $$;

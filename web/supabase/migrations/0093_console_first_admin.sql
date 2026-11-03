set local lock_timeout = '5s';

-- console_add_first_admin: the console's first admin for a company (multi-tenant part 4's createFirstAdmin,
-- which updated profiles.role/active/delegate_id until 0090 revoked that). Service role only: the console
-- has no signed-in company session. Someone who already has an account becomes an active admin of the
-- company (a membership, added or changed); for a new address it writes a pending admin login, which
-- handle_new_user turns into the membership when the console then creates the Auth user.
-- Owned by postgres (scripts/definer-allowlist.ts): it writes one named company's rows without a bound
-- session, which tenant_definer's company policies would refuse.
create function public.console_add_first_admin(p_company uuid, p_email text, p_full_name text) returns void
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
  select p.user_id into v_user from public.profiles p where p.email = v_email limit 1;
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

alter function public.console_add_first_admin(uuid, text, text) owner to postgres;
revoke all on function public.console_add_first_admin(uuid, text, text) from public, anon, authenticated;
grant execute on function public.console_add_first_admin(uuid, text, text) to service_role;

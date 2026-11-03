set local lock_timeout = '5s';

-- console_set_company: the console saves the company that provision_company (0095 in the shared
-- database) created on its tenant row, with the console admin as the audit actor like the other console
-- writes. It never moves a tenant that already serves a company to another one.
create function public.console_set_company(p_slug text, p_company_id uuid, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_current uuid;
begin
  if p_company_id is null then
    raise exception 'Missing company id';
  end if;
  select t.company_id into v_current from public.tenants t where t.slug = p_slug for update;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
  if v_current is not null and v_current <> p_company_id then
    raise exception '% already has a company', p_slug;
  end if;
  if v_current is null then
    perform control_private.act(p_actor);
    update public.tenants set company_id = p_company_id where slug = p_slug;
  end if;
end $$;

revoke execute on function public.console_set_company(text, uuid, text) from public, anon, authenticated;
grant execute on function public.console_set_company(text, uuid, text) to service_role;

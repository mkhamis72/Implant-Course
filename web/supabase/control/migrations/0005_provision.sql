set local lock_timeout = '5s';

-- A company is served by one tenant row per project. Per project, not globally: local stacks are separate
-- databases that each hold academy's id (scripts/console-local.ts maps two of them to it). In production
-- every company is in the one shared project, so this is one tenant per company.
create unique index tenants_company_key on public.tenants (supabase_url, company_id) where company_id is not null;

-- console_set_company: saves the company that provision_company (0095 in the shared database) created on
-- its tenant row, with the actor in the audit like the other console writes (the console admin's email,
-- or 'script' from tenant:register). It never moves a tenant that already serves a company to another
-- one, and never gives a company a second tenant in the same project.
create function public.console_set_company(p_slug text, p_company_id uuid, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_current uuid;
  v_url text;
  v_other text;
begin
  if p_company_id is null then
    raise exception 'Missing company id';
  end if;
  select t.company_id, t.supabase_url into v_current, v_url from public.tenants t where t.slug = p_slug for update;
  if not found then
    raise exception 'Unknown company %', p_slug;
  end if;
  if v_current is not null and v_current <> p_company_id then
    raise exception '% already has a company', p_slug;
  end if;
  select t.slug into v_other from public.tenants t
  where t.company_id = p_company_id and t.supabase_url = v_url and t.slug <> p_slug;
  if v_other is not null then
    raise exception 'Company % is already registered as %', p_company_id, v_other;
  end if;
  if v_current is null then
    perform control_private.act(p_actor);
    update public.tenants set company_id = p_company_id where slug = p_slug;
  end if;
end $$;

revoke execute on function public.console_set_company(text, uuid, text) from public, anon, authenticated;
grant execute on function public.console_set_company(text, uuid, text) to service_role;

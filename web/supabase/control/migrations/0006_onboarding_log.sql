-- Multi-tenant part 5 (onboarding from the console): the company's History also records a first admin
-- invited by email (p_detail: their email) and an address added to the Vercel project (p_detail: the host).
-- Same signature as 0003, so its grants stay.
create or replace function public.console_log(p_slug text, p_action text, p_detail text, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('first_admin_created', 'admin_password_reset', 'first_admin_invited', 'domain_added') then
    raise exception 'Unknown action %', p_action;
  end if;
  if not exists (select 1 from public.tenants where slug = p_slug) then
    raise exception 'Unknown company %', p_slug;
  end if;
  insert into public.tenant_audit (slug, action, actor, reason)
  values (p_slug, p_action, coalesce(nullif(trim(p_actor), ''), current_user), p_detail);
end $$;

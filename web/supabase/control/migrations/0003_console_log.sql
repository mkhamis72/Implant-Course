-- Console (part 4 review): the first-admin login of a company is created in that company's own project,
-- outside the control database. This records it (who, for whom) in the company's History.
-- Never the password: p_detail is the target email.
create function public.console_log(p_slug text, p_action text, p_detail text, p_actor text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_action not in ('first_admin_created', 'admin_password_reset') then
    raise exception 'Unknown action %', p_action;
  end if;
  if not exists (select 1 from public.tenants where slug = p_slug) then
    raise exception 'Unknown company %', p_slug;
  end if;
  insert into public.tenant_audit (slug, action, actor, reason)
  values (p_slug, p_action, coalesce(nullif(trim(p_actor), ''), current_user), p_detail);
end $$;
revoke execute on function public.console_log(text, text, text, text) from public, anon, authenticated;
grant execute on function public.console_log(text, text, text, text) to service_role;

-- Functions created in control_private get EXECUTE for public by default; nothing there is meant to be callable.
revoke execute on all functions in schema control_private from public;

-- Merge of control into production, release 3: console accounts and company accounts live in the same
-- self_auth tables. is_console_user (0105) trusted any active console_users row; a company account listed there by
-- mistake would have passed. Now the signed-in account must also be a Self-Auth account of company 'console'.
-- Same signature: owner (postgres) and grants (authenticated only) are kept.
create or replace function public.is_console_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(app.current_aal() = 'aal2', false)
     and exists (select 1 from public.console_users u where u.user_id = app.current_user_id() and u.active)
     and exists (select 1 from self_auth."user" s where s.id = app.current_user_id() and s."companyId" = 'console')
$$;

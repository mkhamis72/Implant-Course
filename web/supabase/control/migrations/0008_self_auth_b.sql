-- Self-Auth, Migration B for the control database (after the rollback window; held by migrate.ts until
-- SELF_AUTH_B_HOLD=0, docs/operations.md §E). console_admins references self_auth."user" again, with 0002's
-- delete action (cascade). 0007 dropped its key to auth.users. is_console_admin (0002) is unchanged.
set local lock_timeout = '5s';

do $$
declare
  v_n bigint;
begin
  select count(*) into v_n from public.console_admins a
  where not exists (select 1 from self_auth."user" u where u.id = a.user_id);
  if v_n > 0 then
    raise exception 'Migration B: rows point at people with no Self-Auth account (console_admins: %). Run self-auth:import --db control, or remove those admins first (docs/operations.md §E, After the window).', v_n;
  end if;
end $$;

alter table public.console_admins add constraint console_admins_user_id_fkey
  foreign key (user_id) references self_auth."user" (id) on delete cascade;

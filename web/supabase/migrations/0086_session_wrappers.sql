-- One database (plan 2): public wrappers for session binding and per-company branding readers
-- (spec §3). PostgREST serves only public, so the company-aware app reaches 0085's app.bind_session and
-- app.current_company_id through these. Additive only: the previous app version calls none of them.
set local lock_timeout = '5s';


-- current_session_id: the sign-in session id from the JWT. Only the definers below call it.
create function app.current_session_id() returns uuid
language sql stable set search_path = '' as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid
$$;
alter function app.current_session_id() owner to postgres;
revoke all on function app.current_session_id() from public, anon, authenticated;

-- bind_my_session: called by the server after sign-in. Binds the session (0085 rules and errors), then
-- forgets the caller's own bindings whose Auth session has ended. The session just bound is kept even
-- if auth.sessions has no row for it.
create function public.bind_my_session(p_company uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.bind_session(p_company);
  delete from app.session_companies sc
  where sc.user_id = app.current_user_id()
    and sc.session_id <> app.current_session_id()
    and not exists (select 1 from auth.sessions s where s.id = sc.session_id);
end $$;
alter function public.bind_my_session(uuid) owner to postgres;
revoke all on function public.bind_my_session(uuid) from public, anon;
grant execute on function public.bind_my_session(uuid) to authenticated;

-- my_session_company: the company this request's session is bound to; null when unbound.
create function public.my_session_company() returns uuid
language sql stable security definer set search_path = '' as $$
  select app.current_company_id()
$$;
alter function public.my_session_company() owner to postgres;
revoke all on function public.my_session_company() from public, anon;
grant execute on function public.my_session_company() to authenticated;

-- branding_for / branding_logo_for: branding_public() and branding_logo() (0040) for one company; the
-- login page renders before sign-in, so anon reads them too. No row for an unknown company.
create function public.branding_for(p_company uuid)
returns table (name text, brand_color text, nav_color text, logo_version int, has_logo boolean)
language sql stable security definer set search_path = '' as $$
  select b.name, b.brand_color, b.nav_color, b.logo_version,
         exists (select 1 from public.branding_logos l where l.company_id = p_company)
  from public.branding b where b.company_id = p_company
$$;

create function public.branding_logo_for(p_company uuid)
returns table (bytes bytea, content_type text)
language sql stable security definer set search_path = '' as $$
  select l.bytes, l.content_type from public.branding_logos l where l.company_id = p_company
$$;

alter function public.branding_for(uuid) owner to postgres;
alter function public.branding_logo_for(uuid) owner to postgres;
revoke all on function public.branding_for(uuid), public.branding_logo_for(uuid) from public;
grant execute on function public.branding_for(uuid), public.branding_logo_for(uuid) to anon, authenticated;

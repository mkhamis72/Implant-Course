-- Once a user has a verified 2FA factor, a password-only (aal1) token grants nothing.
-- Every policy uses these helpers, so all current and future tables inherit the rule.

create function app_private.mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    or not exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    );
$$;

create or replace function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.mfa_satisfied()
    and exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select app_private.mfa_satisfied()
    and exists (
      select 1 from public.profiles p
      where p.user_id = auth.uid() and p.active and p.role = 'admin'
    );
$$;

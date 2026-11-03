/**
 * Security-definer functions in `public` and `app_private` that stay owned by `postgres` once every other
 * definer there is owned by `tenant_definer` (one database, spec §5). Schema `app` is outside these two
 * schemas and stays postgres-owned as a whole. Used by the `definer-owner` guard
 * (`tests/db/one-db-guards.test.ts`) and by `migrate.ts`'s owner check.
 */
export const DEFINER_ALLOWLIST: ReadonlySet<string> = new Set([
  // Read the caller's own Auth factors (auth.mfa_factors), which tenant_definer can't see.
  'app_private.mfa_satisfied',
  'public.mfa_setup_done',
  // Auth trigger on auth.users: runs before the new user has a session or a company.
  'app_private.handle_new_user',
  'app_private.default_permissions',
  // Audit trigger: writes audit_log for every table, whatever the caller's company.
  'app_private.audit_row',
  // Deletes from auth.sessions.
  'public.admin_end_sessions',
  // Pre-login branding readers: the login page renders before there is a session.
  'public.branding_for',
  'public.branding_logo_for',
  // The previous pre-login readers (academy only, anon-callable) until 0095 drops them.
  'public.branding_public',
  'public.branding_logo',
  // Console, service role only (0093): writes a named company's first admin without a bound session.
  'public.console_add_first_admin',
  // Console, service role only (0093): removes that pending row again when the Auth call fails.
  'public.console_cancel_pending_login',
  // The console / service-role functions that later plan-3 tasks add join this list there.
]);

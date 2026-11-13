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
  // Trigger on self_auth."user" (0101): provisions a Self-Auth user from its pending login, before any session.
  'app_private.handle_new_self_auth_user',
  // Triggers on auth.users and self_auth."user" (0101): stand in for the dropped foreign keys' delete actions.
  'app_private.handle_deleted_user',
  // Audit trigger: writes audit_log for every table, whatever the caller's company.
  'app_private.audit_row',
  // Deletes from auth.sessions.
  'public.admin_end_sessions',
  // Pre-login branding readers: the login page renders before there is a session.
  'public.branding_for',
  'public.branding_logo_for',
  // The previous pre-login readers (academy only): dropped by 0096. Listed so migrate.ts's owner check passes on
  // 0092 to 0095 when a database is built from scratch; once dropped they are in no catalog, so no guard sees them.
  'public.branding_public',
  'public.branding_logo',
  // Console, service role only (0093): writes a named company's first admin without a bound session.
  'public.console_add_first_admin',
  // Console, service role only (0093): removes that pending row again when the Auth call fails.
  'public.console_cancel_pending_login',
  // Console and tenant:register --provision, service role only (0095): a new company and its starting data.
  'public.provision_company',
  // Company list triggers (0104): check addresses across every company and write company_log, whoever writes the row.
  'app_private.companies_list_normalise',
  'app_private.companies_list_audit',
  // Console in production (0105): reads console_users for the signed-in console account; and the console's
  // service-role-only writes to the company list, for any company, with no session.
  'public.is_console_user',
  'public.console_update_company',
  'public.console_set_company_status',
  'public.console_log_company',
  // The console / service-role functions that later plan-3 tasks add join this list there.
]);

import 'server-only';
import { consoleSource } from './env';
import { createConsoleServiceClient } from './supabase';

/** The list of console admins and the database's own check of the caller, per source. */
export const CONSOLE_ADMIN_TABLE = { control: 'console_admins', production: 'console_users' } as const;
export const CONSOLE_GUARD_RPC = { control: 'is_console_admin', production: 'is_console_user' } as const;

/** True when this console account has an active row in the console admins list. */
export async function consoleAdminActive(userId: string): Promise<boolean> {
  const table = CONSOLE_ADMIN_TABLE[consoleSource()];
  const { data } = await createConsoleServiceClient().from(table).select('active').eq('user_id', userId).maybeSingle();
  return Boolean((data as { active?: boolean } | null)?.active);
}

import 'server-only';
import { createConsoleServiceClient } from './supabase';

/** The database's own check of the signed-in console admin (0105, 0106). */
export const CONSOLE_GUARD_RPC = 'is_console_user';

/** True when this console account has an active row in public.console_users. */
export async function consoleAdminActive(userId: string): Promise<boolean> {
  const { data } = await createConsoleServiceClient().from('console_users').select('active').eq('user_id', userId).maybeSingle();
  return Boolean((data as { active?: boolean } | null)?.active);
}

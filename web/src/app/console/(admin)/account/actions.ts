'use server';

import { requireConsoleAdmin } from '@/lib/console/session';
import { CONSOLE_COMPANY, consoleAuth } from '@/lib/self-auth/console';
import { createLimiter } from '@/lib/auth/rate-limit';
import { FORGOT_TOO_MANY } from '@/lib/auth/password-reset';
import { emailEnabled } from '@/lib/flags';

const perAdmin = createLimiter(3, 15 * 60_000);

/** Changing the password goes through the emailed reset link: the signed-in admin asks for one to their own address. */
export async function emailConsolePasswordLink(): Promise<{ sent?: string; error?: string }> {
  const admin = await requireConsoleAdmin();
  if (!emailEnabled()) return { error: 'Email is not available. Ask the owner to reset your password.' };
  if (!perAdmin.allow(admin.userId)) return { error: FORGOT_TOO_MANY };
  try {
    await (await consoleAuth()).requestPasswordReset({ companyId: CONSOLE_COMPANY, email: admin.email });
  } catch (e) {
    console.error('emailConsolePasswordLink failed', e instanceof Error ? e.name : 'error');
  }
  return { sent: 'We emailed a link to your address. It works for 24 hours.' };
}

import Link from 'next/link';
import { IdleTimer } from '@/components/idle-timer';
import { CONSOLE_IDLE_MINUTES } from '@/lib/console/middleware';
import { controlConfig } from '@/lib/console/env';
import { requireConsoleAdmin } from '@/lib/console/session';
import { signOutConsole } from '../auth-actions';

export default async function ConsoleAdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireConsoleAdmin();
  const { url, anonKey } = controlConfig();
  return (
    <>
      <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-3">
        <span className="font-semibold">Console</span>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted">{admin.email}</span>
          <Link href="/console/account" className="text-accent hover:underline">Change password</Link>
          <form action={signOutConsole}>
            <button className="btn-secondary btn">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6">{children}</main>
      <IdleTimer timeoutMinutes={CONSOLE_IDLE_MINUTES} supabase={{ url, anonKey }} loginPath="/console/login" heartbeatPath="/console/api/activity" />
    </>
  );
}

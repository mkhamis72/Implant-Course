import { readParams, type PageSearchParams } from '@/lib/search-params';
import { ConsoleLoginForm } from './login-form';

export default async function ConsoleLoginPage({ searchParams }: { searchParams: PageSearchParams }) {
  const { reason, notice } = await readParams(searchParams, 'reason', 'notice');
  return (
    <main className="mx-auto mt-10 max-w-sm px-4 sm:mt-24">
      <div className="card space-y-6">
        <h1 className="text-xl font-semibold">Console</h1>
        {notice === 'password_reset' && (
          <p role="status" className="rounded bg-ok-soft p-3 text-sm">
            Your password was changed. Sign in with the new one.
          </p>
        )}
        {reason === 'idle' && <p className="rounded bg-warn-soft p-3 text-sm text-warn">You were signed out after 15 minutes of inactivity.</p>}
        {reason === 'not-admin' && (
          <p role="alert" className="rounded bg-bad-soft p-3 text-sm text-bad">
            Not a console admin.
          </p>
        )}
        <ConsoleLoginForm />
      </div>
    </main>
  );
}

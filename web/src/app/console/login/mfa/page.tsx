import { MfaForm } from '@/app/login/mfa/mfa-form';
import { requireConsoleUser } from '@/lib/console/session';
import { signOutConsole, verifyConsoleMfa } from '../../auth-actions';

export default async function ConsoleMfaPage() {
  await requireConsoleUser();
  return (
    <main className="mx-auto mt-10 max-w-sm px-4 sm:mt-24">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Console</h1>
        <p className="text-sm text-muted">Enter the code from your authenticator app.</p>
        <MfaForm action={verifyConsoleMfa} />
        <form action={signOutConsole}>
          <button className="text-sm hover:underline">Sign out</button>
        </form>
      </div>
    </main>
  );
}

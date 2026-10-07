import { requireConsoleUser } from '@/lib/console/session';
import { ConsoleSetupForm } from './setup-form';

export default async function ConsoleMfaSetupPage() {
  await requireConsoleUser();
  return (
    <main className="mx-auto mt-10 max-w-md px-4 sm:mt-24">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Console</h1>
        <p className="text-sm text-muted">Two-factor authentication is required for the console. Set up an authenticator app to continue.</p>
        <ConsoleSetupForm />
      </div>
    </main>
  );
}

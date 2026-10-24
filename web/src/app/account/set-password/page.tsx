import { requireSignedIn } from '@/lib/auth/session';
import { SetPasswordForm } from './form';

export default async function SetPasswordPage() {
  // Staff and delegate logins (invite, temporary password, recovery); open while 2FA set-up is required too.
  await requireSignedIn({ allowMfaSetup: true });
  return (
    <main className="mx-auto mt-10 max-w-sm px-4 sm:mt-24">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Set your password</h1>
        <p className="text-sm text-muted">At least 10 characters.</p>
        <SetPasswordForm />
      </div>
    </main>
  );
}

import { requireActiveUser } from '@/lib/auth/session';
import { SetPasswordForm } from './form';

export default async function SetPasswordPage() {
  await requireActiveUser();
  return (
    <main className="mx-auto mt-24 max-w-sm">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Set your password</h1>
        <p className="text-sm text-gray-600">At least 10 characters.</p>
        <SetPasswordForm />
      </div>
    </main>
  );
}

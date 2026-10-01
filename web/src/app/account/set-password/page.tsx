import { SetPasswordForm } from './form';

export default function SetPasswordPage() {
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

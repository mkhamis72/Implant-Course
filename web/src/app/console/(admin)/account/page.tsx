import { requireConsoleAdmin } from '@/lib/console/session';
import { ChangePasswordForm } from './change-password-form';

export default async function ConsoleAccountPage() {
  const admin = await requireConsoleAdmin();
  return (
    <div className="space-y-4">
      <h1>Change password</h1>
      <p className="text-sm text-muted">For your console login, {admin.email}. Your authenticator app stays as it is.</p>
      <ChangePasswordForm />
    </div>
  );
}

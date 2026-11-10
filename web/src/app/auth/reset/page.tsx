import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { SetPasswordForm } from '../set-password-form';
import { resetPasswordAction } from './actions';

// The link carries the token in its address: keep it out of the Referer header.
export const metadata: Metadata = { referrer: 'no-referrer' };

export default async function ResetPasswordPage({ searchParams }: { searchParams: PageSearchParams }) {
  const { token } = await readParams(searchParams, 'token');
  if (!token) redirect('/auth/error?code=missing_token');
  return (
    <main className="mx-auto mt-10 max-w-sm px-4 sm:mt-24">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Set a new password</h1>
        <p className="text-sm text-muted">At least 10 characters.</p>
        <SetPasswordForm action={resetPasswordAction} token={token} />
      </div>
    </main>
  );
}

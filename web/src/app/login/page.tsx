import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { emailEnabled } from '@/lib/flags';
import { getBranding } from '@/lib/branding/get';
import { LoginForm } from './login-form';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { COMPANY_REFUSED_MESSAGE } from '@/lib/auth/company-session';
import { mapAuthError } from '@/lib/auth/errors';
import { googleConfig } from '@/lib/self-auth/google-config';

const GOOGLE_ERRORS = ['google_no_account', 'google_disabled', 'google_unverified', 'google_failed'];

export default async function LoginPage({ searchParams }: { searchParams: PageSearchParams }) {
  const branding = await getBranding();
  const { reason, error, notice } = await readParams(searchParams, 'reason', 'error', 'notice');
  return (
    <main className="mx-auto mt-10 max-w-sm px-4 sm:mt-24">
      <div className="card space-y-6">
        <div className="flex items-center gap-3">
          <BrandMark logoUrl={branding.logoUrl} className="h-9 w-9" />
          <h1 className="text-xl font-semibold">{branding.name}</h1>
        </div>
        {reason === 'idle' && (
          <p className="rounded bg-warn-soft p-3 text-sm text-warn">You were signed out after a period of inactivity.</p>
        )}
        {notice === 'password_reset' && <p role="status" className="rounded bg-ok-soft p-3 text-sm">Your password is changed. Sign in with the new one.</p>}
        {notice === 'invite_accepted' && <p role="status" className="rounded bg-ok-soft p-3 text-sm">Your password is set. Sign in to continue.</p>}
        {error === 'company' && <p role="alert" className="rounded bg-bad-soft p-3 text-sm text-bad">{COMPANY_REFUSED_MESSAGE}</p>}
        {GOOGLE_ERRORS.includes(error) && <p role="alert" className="rounded bg-bad-soft p-3 text-sm text-bad">{mapAuthError(error)}</p>}
        <LoginForm />
        {googleConfig() && (
          <a href="/auth/google/start" className="btn-secondary btn w-full justify-center">
            Sign in with Google
          </a>
        )}
        {emailEnabled() && (
          <Link href="/login/forgot" className="block text-center text-sm hover:underline">
            Forgot password?
          </Link>
        )}
      </div>
    </main>
  );
}

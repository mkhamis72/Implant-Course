import Link from 'next/link';
import { BrandMark } from '@/components/brand-mark';
import { emailEnabled } from '@/lib/flags';
import { getBranding } from '@/lib/branding/get';
import { LoginForm } from './login-form';
import { readParams, type PageSearchParams } from '@/lib/search-params';

export default async function LoginPage({ searchParams }: { searchParams: PageSearchParams }) {
  const branding = await getBranding();
  const reason = (await readParams(searchParams, 'reason')).reason || undefined;
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
        <LoginForm />
        {emailEnabled() && (
          <Link href="/login/forgot" className="block text-center text-sm hover:underline">
            Forgot password?
          </Link>
        )}
      </div>
    </main>
  );
}

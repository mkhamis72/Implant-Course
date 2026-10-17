import Link from 'next/link';
import { notFound } from 'next/navigation';
import { emailEnabled } from '@/lib/flags';
import { ForgotForm } from './form';

export default function ForgotPasswordPage() {
  if (!emailEnabled()) notFound();
  return (
    <main className="mx-auto mt-10 max-w-sm px-4 sm:mt-24">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Forgot your password?</h1>
        <p className="text-sm text-muted">Enter your email and we&apos;ll send you a link to set a new one.</p>
        <ForgotForm />
        <Link href="/login" className="text-sm hover:underline">
          Back to sign in
        </Link>
      </div>
    </main>
  );
}

import Link from 'next/link';
import { mapAuthError } from '@/lib/auth/errors';

export default async function AuthErrorPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return (
    <main className="mx-auto mt-24 max-w-md">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Link problem</h1>
        <p className="text-gray-700">{mapAuthError(code ?? 'otp_expired')}</p>
        <Link href="/login" className="btn-secondary btn">
          Go to sign in
        </Link>
      </div>
    </main>
  );
}

import { LoginForm } from './login-form';
import { readParams, type PageSearchParams } from '@/lib/search-params';

export default async function LoginPage({ searchParams }: { searchParams: PageSearchParams }) {
  const reason = (await readParams(searchParams, 'reason')).reason || undefined;
  return (
    <main className="mx-auto mt-24 max-w-sm">
      <div className="card space-y-6">
        <h1 className="text-xl font-semibold">Implant Course Manager</h1>
        {reason === 'idle' && (
          <p className="rounded bg-amber-50 p-3 text-sm text-amber-900">You were signed out after a period of inactivity.</p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}

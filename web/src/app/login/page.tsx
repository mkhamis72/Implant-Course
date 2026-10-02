import { Mark } from '@/components/mark';
import { LoginForm } from './login-form';
import { readParams, type PageSearchParams } from '@/lib/search-params';

export default async function LoginPage({ searchParams }: { searchParams: PageSearchParams }) {
  const reason = (await readParams(searchParams, 'reason')).reason || undefined;
  return (
    <main className="mx-auto mt-10 max-w-sm px-4 sm:mt-24">
      <div className="card space-y-6">
        <div className="flex items-center gap-3">
          <Mark className="h-9 w-9" />
          <h1 className="text-xl font-semibold">Implant Course Manager</h1>
        </div>
        {reason === 'idle' && (
          <p className="rounded bg-warn-soft p-3 text-sm text-warn">You were signed out after a period of inactivity.</p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}

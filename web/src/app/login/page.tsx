import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reason?: string }> }) {
  const { reason } = await searchParams;
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

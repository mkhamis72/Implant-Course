import { redirect } from 'next/navigation';
import { getCurrentProfile } from '@/lib/auth/session';
import { signOut } from '@/app/actions/auth';

export default async function DeactivatedPage() {
  const profile = await getCurrentProfile();
  if (profile?.active) redirect('/');
  return (
    <main className="mx-auto mt-24 max-w-md">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Account deactivated</h1>
        <p className="text-gray-700">Your account is not active. Ask an admin to activate it.</p>
        <form action={signOut}>
          <button className="btn-secondary btn">Sign out</button>
        </form>
      </div>
    </main>
  );
}

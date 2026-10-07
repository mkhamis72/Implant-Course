import { MfaForm } from './mfa-form';
import { signOut } from '@/app/actions/auth';
import { verifyMfa } from './actions';

export default function MfaPage() {
  return (
    <main className="mx-auto mt-10 max-w-sm px-4 sm:mt-24">
      <div className="card space-y-4">
        <h1 className="text-xl font-semibold">Two-factor authentication</h1>
        <p className="text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
        <MfaForm action={verifyMfa} />
        <form action={signOut}>
          <button className="text-sm hover:underline">Sign out</button>
        </form>
      </div>
    </main>
  );
}

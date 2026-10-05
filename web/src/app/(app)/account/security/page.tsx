import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { EnrollTotp } from './enroll-totp';
import { removeFactor } from './actions';
import { requireSignedIn } from '@/lib/auth/session';

export default async function SecurityPage() {
  await requireSignedIn(); // staff and delegate logins alike
  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const verified = (data?.totp ?? []).filter((f) => f.status === 'verified');

  return (
    <div className="max-w-xl space-y-6">
      <h1>Account security</h1>
      <section className="card space-y-4">
        <h2 className="font-semibold">Two-factor authentication (optional)</h2>
        {verified.length > 0 ? (
          <div className="space-y-3">
            <p className="text-ok">Authenticator active</p>
            {verified.map((factor) => (
              <form key={factor.id} action={removeFactor}>
                <input type="hidden" name="factor_id" value={factor.id} />
                <button className="btn-secondary btn">Remove authenticator</button>
              </form>
            ))}
          </div>
        ) : (
          <EnrollTotp />
        )}
      </section>
      <section className="card space-y-2">
        <h2 className="font-semibold">Password</h2>
        <Link href="/account/set-password" className="text-accent hover:underline">
          Change password
        </Link>
      </section>
    </div>
  );
}

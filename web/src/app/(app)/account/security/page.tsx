import { EnrollTotp } from './enroll-totp';
import { confirmEnroll, removeFactor, startEnroll } from './actions';
import { requireSignedIn } from '@/lib/auth/session';
import { currentSelfAuthSession } from '@/lib/self-auth/session';
import { tenantAuth } from '@/lib/self-auth/tenant';
import { emailEnabled } from '@/lib/flags';
import { FinishSetup } from './finish-setup';
import { PasswordLink } from './password-link';
import { ChangePassword } from './change-password';

export default async function SecurityPage() {
  const profile = await requireSignedIn({ allowMfaSetup: true }); // staff and delegate logins alike; the one page open while 2FA set-up is required
  const session = await currentSelfAuthSession();
  const verified = session ? await (await tenantAuth()).totp.hasTotp(session.userId) : false;

  return (
    <div className="max-w-xl space-y-6">
      <h1>Account security</h1>
      <section className="card space-y-4">
        <h2 className="font-semibold">Two-factor authentication{profile.mfa_setup_required ? '' : ' (optional)'}</h2>
        {profile.mfa_setup_required && (
          <p role="status" className="rounded-md border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
            An administrator reset your two-factor authentication. Set up an authenticator to continue using the app.
          </p>
        )}
        {verified ? (
          <div className="space-y-3">
            <p className="text-ok">Authenticator active</p>
            {profile.mfa_setup_required && <FinishSetup />}
            {/* Removing it needs a session that passed the code check (aal2), which every page behind the sign-in has. */}
            <form action={removeFactor}>
              <button className="btn-secondary btn">Remove authenticator</button>
            </form>
          </div>
        ) : (
          <EnrollTotp start={startEnroll} confirm={confirmEnroll} />
        )}
      </section>
      <section className="card space-y-4">
        <h2 className="font-semibold">Password</h2>
        <ChangePassword />
        {emailEnabled() && <PasswordLink />}
      </section>
    </div>
  );
}

import { createClient } from '@/lib/supabase/server';
import { requireAdmin, type Profile } from '@/lib/auth/session';
import { InviteForm } from './invite-form';
import { UserRow, type Account } from './user-row';
import { emailEnabled } from '@/lib/flags';
import { toPermissions } from '@/lib/auth/permissions';
import { hasVerifiedFactor, listSignIns } from '@/lib/admin/auth-accounts';
import type { HistoryEntry } from '@/lib/admin/history';

export default async function UsersPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email, role, active, delegate_id, mfa_setup_required, permissions:user_permissions(area, level)')
    .order('full_name');
  if (error) throw new Error('Could not load users');
  const users = ((data ?? []) as unknown as (Omit<Profile, 'permissions'> & { permissions: { area: string; level: string }[] })[])
    .map((u) => ({ ...u, permissions: toPermissions(u.permissions) }) as Profile);

  // Auth answers for sign-in times and factors; a failure there shows "unknown" rather than breaking the page.
  const signIns = await listSignIns().catch((e: Error) => {
    console.error(e.message);
    return null;
  });
  const accounts = await Promise.all(
    users.map(async (user): Promise<Account> => {
      const isSelf = user.user_id === me.user_id;
      const [factor, history] = await Promise.all([
        isSelf ? false : hasVerifiedFactor(user.user_id),
        supabase.rpc('admin_user_history', { p_user: user.user_id }),
      ]);
      if (history.error) console.error('admin_user_history failed:', history.error.message);
      return {
        lastSignIn: signIns ? (signIns.get(user.user_id) ?? null) : undefined,
        hasFactor: factor === true,
        history: (history.data ?? []) as HistoryEntry[],
      };
    }),
  );

  return (
    <div className="space-y-6">
      <h1>Users</h1>
      <InviteForm emailOn={emailEnabled()} />
      <p className="text-sm text-muted">Delegate logins are created from the delegate’s page.</p>
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user, i) => (
              <UserRow
                key={user.user_id}
                user={user}
                isSelf={user.user_id === me.user_id}
                account={accounts[i]}
                emailOn={emailEnabled()}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

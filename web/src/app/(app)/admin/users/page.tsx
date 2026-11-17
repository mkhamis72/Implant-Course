import { createClient } from '@/lib/supabase/server';
import { currentTenant } from '@/lib/tenant/current';
import { requireAdmin, type Profile } from '@/lib/auth/session';
import { InviteForm } from './invite-form';
import { UserRow, type Account } from './user-row';
import { emailEnabled } from '@/lib/flags';
import { toPermissions } from '@/lib/auth/permissions';
import { invitePending, listAccounts } from '@/lib/admin/auth-accounts';
import type { HistoryEntry } from '@/lib/admin/history';

/** Other users' rows carry no company features or plan, so they cannot be passed to canView. */
export type UserListRow = Omit<Profile, 'features' | 'plan'>;

type MemberRow = Pick<Profile, 'user_id' | 'role' | 'active' | 'delegate_id' | 'mfa_setup_required'> & {
  profile: { full_name: string; email: string } | null;
};

export default async function UsersPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const { companyId } = await currentTenant();
  const [members, perms] = await Promise.all([
    supabase
      .from('company_members')
      .select('user_id, role, active, delegate_id, mfa_setup_required, profile:profiles(full_name, email)')
      .eq('company_id', companyId),
    supabase.from('user_permissions').select('user_id, area, level').eq('company_id', companyId),
  ]);
  if (members.error || perms.error) throw new Error('Could not load users');
  const permRows = (perms.data ?? []) as { user_id: string; area: string; level: string }[];
  const users = ((members.data ?? []) as unknown as MemberRow[])
    .map(({ profile, ...m }): UserListRow => ({
      ...m,
      full_name: profile?.full_name ?? '',
      email: profile?.email ?? '',
      permissions: toPermissions(permRows.filter((p) => p.user_id === m.user_id)),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  // Self-Auth answers for sign-in times, authenticators and invitations; a failure there shows "unknown" rather than breaking the page.
  const states = await listAccounts().catch((e: Error) => {
    console.error('Could not load sign-in details:', e.name);
    return null;
  });
  const accounts = await Promise.all(
    users.map(async (user): Promise<Account> => {
      const isSelf = user.user_id === me.user_id;
      const history = await supabase.rpc('admin_user_history', { p_user: user.user_id });
      if (history.error) console.error('admin_user_history failed:', history.error.message);
      const state = states?.get(user.user_id);
      return {
        lastSignIn: states ? (state?.lastSignIn ?? null) : undefined,
        hasFactor: !isSelf && state?.hasFactor === true,
        invitePending: states ? invitePending(state) : false,
        hasGoogle: state?.hasGoogle === true,
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
                features={me.features}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { createClient } from '@/lib/supabase/server';
import { currentTenant } from '@/lib/tenant/current';
import { requireAdmin, type Profile } from '@/lib/auth/session';
import { InviteForm } from './invite-form';
import { UserRow, type Account } from './user-row';
import { emailEnabled } from '@/lib/flags';
import { toPermissions } from '@/lib/auth/permissions';
import { hasVerifiedFactor, listSignIns } from '@/lib/admin/auth-accounts';
import type { HistoryEntry } from '@/lib/admin/history';

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
    .map(({ profile, ...m }): Profile => ({
      ...m,
      full_name: profile?.full_name ?? '',
      email: profile?.email ?? '',
      permissions: toPermissions(permRows.filter((p) => p.user_id === m.user_id)),
    }))
    .sort((a, b) => a.full_name.localeCompare(b.full_name));

  // Auth answers for sign-in times and factors; a failure there shows "unknown" rather than breaking the page.
  const signIns = await listSignIns(users.map((u) => u.user_id)).catch((e: Error) => {
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

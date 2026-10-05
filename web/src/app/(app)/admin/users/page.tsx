import { createClient } from '@/lib/supabase/server';
import { requireAdmin, type Profile } from '@/lib/auth/session';
import { InviteForm } from './invite-form';
import { UserRow } from './user-row';
import { emailEnabled } from '@/lib/flags';
import { toPermissions } from '@/lib/auth/permissions';

export default async function UsersPage() {
  const me = await requireAdmin();
  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email, role, active, delegate_id, permissions:user_permissions(area, level)')
    .order('full_name');
  if (error) throw new Error('Could not load users');

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
            {((users ?? []) as unknown as (Omit<Profile, 'permissions'> & { permissions: { area: string; level: string }[] })[])
              .map((u) => ({ ...u, permissions: toPermissions(u.permissions) }) as Profile)
              .map((user) => (
              <UserRow key={user.user_id} user={user} isSelf={user.user_id === me?.user_id} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

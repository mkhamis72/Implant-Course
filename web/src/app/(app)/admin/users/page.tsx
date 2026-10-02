import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile, type Profile } from '@/lib/auth/session';
import { InviteForm } from './invite-form';
import { UserRow } from './user-row';

export default async function UsersPage() {
  const me = await getCurrentProfile();
  const supabase = await createClient();
  const { data: users, error } = await supabase
    .from('profiles')
    .select('user_id, full_name, email, role, active')
    .order('full_name');
  if (error) throw new Error('Could not load users');

  return (
    <div className="space-y-6">
      <h1>Users</h1>
      <InviteForm />
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
            {(users as Profile[]).map((user) => (
              <UserRow key={user.user_id} user={user} isSelf={user.user_id === me?.user_id} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

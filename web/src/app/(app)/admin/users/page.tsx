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
      <h1 className="text-2xl font-semibold">Users</h1>
      <InviteForm />
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="text-gray-500">
              <th className="pb-2">Name</th>
              <th className="pb-2">Email</th>
              <th className="pb-2">Role</th>
              <th className="pb-2">Status</th>
              <th className="pb-2" />
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

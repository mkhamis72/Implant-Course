import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { teachingOn } from '@/lib/modules/modules';
import type { Supervisor } from '@/lib/schedule/types';
import { AddSupervisor, SupervisorRow } from './supervisor-row';

export default async function SupervisorsPage() {
  const profile = await requireAdmin();
  if (!teachingOn(profile.features)) redirect('/admin/users');
  const supabase = await createClient();
  const { data, error } = await supabase.from('supervisors').select('id, full_name, active').order('full_name');
  if (error) throw new Error('Could not load supervisors');
  return (
    <div className="space-y-6">
      <h1>Supervisors</h1>
      <p className="text-muted">The names offered as supervisor on bookings and implants. Inactive supervisors stay on past records.</p>
      <AddSupervisor />
      <ul className="card">
        {((data ?? []) as Supervisor[]).map((s) => (
          <SupervisorRow key={s.id} supervisor={s} />
        ))}
      </ul>
    </div>
  );
}

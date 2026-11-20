import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import { currentTenant } from '@/lib/tenant/current';
import type { Doctor } from '@/lib/schedule/types';
import { AddDoctor, DoctorRow, type Login } from './doctor-row';

type MemberRow = { user_id: string; role: string; active: boolean; profile: { full_name: string; email: string } | null };

export default async function DoctorsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { companyId } = await currentTenant();
  const [doctors, staff] = await Promise.all([
    supabase.from('doctors').select('id, name, active, user_id').order('name'),
    supabase.from('company_members').select('user_id, role, active, profile:profiles(full_name, email)').eq('company_id', companyId),
  ]);
  if (doctors.error || staff.error) throw new Error('Could not load doctors');
  const list = (doctors.data ?? []) as Doctor[];
  const members = (staff.data ?? []) as unknown as MemberRow[];
  const login = (m: MemberRow): Login => ({ user_id: m.user_id, full_name: m.profile?.full_name ?? '', email: m.profile?.email ?? '' });
  const linked = new Set(list.map((d) => d.user_id).filter(Boolean));
  // Offered for linking: this company's active admins and organizers not linked to a doctor yet.
  const free = members
    .filter((m) => m.active && (m.role === 'admin' || m.role === 'organizer') && !linked.has(m.user_id))
    .map(login)
    .sort((a, b) => a.full_name.localeCompare(b.full_name));
  return (
    <div className="space-y-6">
      <h1>Doctors</h1>
      <p className="text-muted">
        The names offered as the doctor who placed an implant. Inactive doctors stay on past records. A doctor linked to a
        login is that user’s default for Placed by.
      </p>
      <AddDoctor />
      <ul className="card">
        {list.map((d) => {
          const member = d.user_id ? members.find((m) => m.user_id === d.user_id) : undefined;
          return <DoctorRow key={d.id} doctor={d} login={member ? login(member) : null} logins={free} />;
        })}
      </ul>
    </div>
  );
}

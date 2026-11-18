import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/session';
import type { Doctor } from '@/lib/schedule/types';
import { AddDoctor, DoctorRow } from './doctor-row';

export default async function DoctorsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const { data, error } = await supabase.from('doctors').select('id, name, active').order('name');
  if (error) throw new Error('Could not load doctors');
  return (
    <div className="space-y-6">
      <h1>Doctors</h1>
      <p className="text-muted">The names offered as the doctor who placed an implant. Inactive doctors stay on past records.</p>
      <AddDoctor />
      <ul className="card">
        {((data ?? []) as Doctor[]).map((d) => (
          <DoctorRow key={d.id} doctor={d} />
        ))}
      </ul>
    </div>
  );
}

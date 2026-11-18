import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/auth/session';
import { teachingOn } from '@/lib/modules/modules';
import type { Lecturer } from '@/lib/schedule/types';
import { AddLecturer, LecturerRow } from './lecturer-row';

export default async function LecturersPage() {
  const profile = await requireAdmin();
  if (!teachingOn(profile.features)) redirect('/admin/users');
  const supabase = await createClient();
  const { data, error } = await supabase.from('lecturers').select('id, full_name, active').order('full_name');
  if (error) throw new Error('Could not load lecturers');
  return (
    <div className="space-y-6">
      <h1>Lecturers</h1>
      <p className="text-muted">The names offered as lecturer on lecture and workshop talks. Inactive lecturers stay on past talks.</p>
      <AddLecturer />
      <ul className="card">
        {((data ?? []) as Lecturer[]).map((l) => (
          <LecturerRow key={l.id} lecturer={l} />
        ))}
      </ul>
    </div>
  );
}

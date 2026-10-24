import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canEdit, canView } from '@/lib/auth/permissions';
import type { StudyRow } from '@/lib/research/studies';
import { NoPatientsNote } from '../research-view';
import { StudyList } from './study-list';

export default async function StudiesPage() {
  const profile = await requirePermission('research');
  const header = (
    <div className="page-header">
      <div>
        <h1>Studies</h1>
        <p className="text-muted">Ethics approvals and protocols. Choose a study when exporting to name it in the file.</p>
      </div>
      <Link href="/patients/research" className="btn-secondary btn">Research</Link>
    </div>
  );

  // Studies are read with Research view and Patients view, as the Research page is.
  if (!canView(profile, 'patients')) {
    return (
      <div className="space-y-6">
        {header}
        <NoPatientsNote />
      </div>
    );
  }

  const supabase = await createClient();
  const [studies, courses] = await Promise.all([supabase.rpc('studies_list'), supabase.rpc('course_options')]);
  if (studies.error) throw new Error('Could not load the studies');
  if (courses.error) throw new Error('Could not load the courses');

  return (
    <div className="space-y-6">
      {header}
      <StudyList
        studies={(studies.data ?? []) as StudyRow[]}
        courses={((courses.data ?? []) as { id: string; name: string }[]).map((c) => ({ id: c.id, name: c.name }))}
        editable={canEdit(profile, 'research')}
        isAdmin={profile.role === 'admin'}
      />
    </div>
  );
}

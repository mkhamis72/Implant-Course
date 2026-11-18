import { requirePermission } from '@/lib/auth/session';
import { teachingOn } from '@/lib/modules/modules';
import { TemplateForm } from '../template-form';

export default async function NewTemplatePage() {
  const profile = await requirePermission('checklists', 'edit');
  return (
    <div className="space-y-6">
      <h1>New template</h1>
      <TemplateForm teaching={teachingOn(profile.features)} />
    </div>
  );
}

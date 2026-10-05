import { requirePermission } from '@/lib/auth/session';
import { TemplateForm } from '../template-form';

export default async function NewTemplatePage() {
  await requirePermission('checklists', 'edit');
  return (
    <div className="space-y-6">
      <h1>New template</h1>
      <TemplateForm />
    </div>
  );
}

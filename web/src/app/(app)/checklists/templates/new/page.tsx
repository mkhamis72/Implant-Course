import { TemplateForm } from '../template-form';

export default function NewTemplatePage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">New template</h1>
      <TemplateForm />
    </div>
  );
}

import { requireConsoleAdmin } from '@/lib/console/session';
import { RegisterForm } from './register-form';

export default async function NewCompanyPage() {
  await requireConsoleAdmin();
  return (
    <div className="max-w-2xl">
      <div className="page-header">
        <h1>Add company</h1>
      </div>
      <p className="mb-4 text-sm text-muted">
        The Supabase project must already exist and be migrated (<code>ENV_FILE=… npm run db:migrate</code>). Keys are checked before anything is saved, and never shown again.
      </p>
      <RegisterForm />
    </div>
  );
}

import { requireConsoleAdmin } from '@/lib/console/session';
import { consoleHost } from '@/lib/console/env';
import { baseDomain } from '@/lib/console/onboarding';
import { emailEnabled } from '@/lib/flags';
import { RegisterForm } from './register-form';

export default async function NewCompanyPage() {
  await requireConsoleAdmin();
  return (
    <div className="max-w-2xl">
      <div className="page-header">
        <h1>Add company</h1>
      </div>
      <p className="mb-4 text-sm text-muted">
        The company gets its own space in the shared database, with its consent forms (its admin switches products on in
        Admin → Catalogue), and its address is added to Vercel. {emailEnabled()
          ? 'The first admin is emailed an invite to set their password.'
          : 'Email is off: the first admin gets a temporary password to pass on.'}
      </p>
      <RegisterForm baseDomain={baseDomain(consoleHost())} />
    </div>
  );
}

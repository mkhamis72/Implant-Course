import Link from 'next/link';
import { requireConsoleAdmin } from '@/lib/console/session';
import { createConsoleServiceClient } from '@/lib/console/supabase';
import { listCompanies } from '@/lib/console/companies';
import { CompaniesTable } from './companies-table';

export default async function ConsoleCompaniesPage() {
  await requireConsoleAdmin();
  const rows = await listCompanies(createConsoleServiceClient());
  return (
    <div>
      <div className="page-header">
        <h1>Companies</h1>
        <Link className="btn" href="/console/companies/new">Add company</Link>
      </div>
      <CompaniesTable companies={rows} />
    </div>
  );
}

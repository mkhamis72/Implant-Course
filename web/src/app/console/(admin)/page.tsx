import Link from 'next/link';
import { requireConsoleAdmin } from '@/lib/console/session';
import { consoleStore } from '@/lib/console/store';
import { CompaniesTable } from './companies-table';

export default async function ConsoleCompaniesPage() {
  await requireConsoleAdmin();
  const rows = await consoleStore().list();
  return (
    <div>
      <div className="page-header">
        <h1>Companies</h1>
        <Link className="btn" href="/console/companies/new">Add company</Link>
      </div>
      <CompaniesTable companies={rows.map(({ slug, name, hosts, status, kind }) => ({ slug, name, hosts, status, kind }))} />
    </div>
  );
}

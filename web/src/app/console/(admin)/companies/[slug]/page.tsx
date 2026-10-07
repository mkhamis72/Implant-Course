import { notFound } from 'next/navigation';
import { requireConsoleAdmin } from '@/lib/console/session';
import { createConsoleServiceClient } from '@/lib/console/supabase';
import { companyAudit, getCompany } from '@/lib/console/companies';
import { formatDateTime } from '@/lib/format';
import { DetailsForm, FirstAdminForm, ReplaceKeysForm, StatusForm } from './forms';

export default async function CompanyPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireConsoleAdmin();
  const { slug } = await params;
  const control = createConsoleServiceClient();
  const company = await getCompany(control, slug);
  if (!company) notFound();
  const history = await companyAudit(control, slug);
  return (
    <div className="max-w-3xl space-y-6">
      <div className="page-header">
        <h1>
          {company.name}{' '}
          {company.status === 'active' ? <span className="badge badge-ok">Active</span> : <span className="badge badge-bad">Suspended</span>}
        </h1>
      </div>
      <DetailsForm slug={company.slug} name={company.name} hosts={company.hosts} />
      <StatusForm slug={company.slug} status={company.status} />
      <ReplaceKeysForm slug={company.slug} />
      <FirstAdminForm slug={company.slug} />
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">History</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td data-label="When">{formatDateTime(h.at)}</td>
                  <td data-label="Who">{h.actor}</td>
                  <td data-label="What">{h.changed.length ? `${h.action} (${h.changed.join(', ')})` : h.action}</td>
                  <td data-label="Reason">{h.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

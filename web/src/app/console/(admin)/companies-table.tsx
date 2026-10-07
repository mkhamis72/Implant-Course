'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { CompanyHealth } from '@/lib/console/companies';
import { checkCompany } from './actions';

type Company = { slug: string; name: string; hosts: string[]; status: 'active' | 'suspended' };

function useHealth(slug: string) {
  const [health, setHealth] = useState<CompanyHealth | null>(null);
  useEffect(() => {
    let live = true;
    checkCompany(slug)
      .then((h) => {
        if (live) setHealth(h);
      })
      .catch(() => {
        if (live) setHealth({ problems: ["Couldn't check"], users: null, patients: null });
      });
    return () => {
      live = false;
    };
  }, [slug]);
  return health;
}

function Row({ company }: { company: Company }) {
  const health = useHealth(company.slug);
  const ok = health !== null && health.problems.length === 0;
  return (
    <tr data-testid={`company-${company.slug}`}>
      <td data-label="Company">
        <Link href={`/console/companies/${company.slug}`}>{company.name}</Link>
        <div className="text-sm text-muted">{company.slug}</div>
      </td>
      <td data-label="Addresses">{company.hosts.join(', ')}</td>
      <td data-label="Status">
        {company.status === 'active' ? <span className="badge badge-ok">Active</span> : <span className="badge badge-bad">Suspended</span>}
      </td>
      <td data-label="Health">
        {!health ? <span className="text-muted">Checking…</span> : ok ? <span className="text-ok">OK</span> : <span className="text-bad">{health.problems.join('; ')}</span>}
      </td>
      <td data-label="Users">{health?.users ?? '—'}</td>
      <td data-label="Patients">{health?.patients ?? '—'}</td>
    </tr>
  );
}

export function CompaniesTable({ companies }: { companies: Company[] }) {
  if (!companies.length) return <p className="text-muted">No companies yet.</p>;
  return (
    <table className="table">
      <thead>
        <tr>
          <th>Company</th>
          <th>Addresses</th>
          <th>Status</th>
          <th>Health</th>
          <th>Users</th>
          <th>Patients</th>
        </tr>
      </thead>
      <tbody>
        {companies.map((c) => (
          <Row key={c.slug} company={c} />
        ))}
      </tbody>
    </table>
  );
}

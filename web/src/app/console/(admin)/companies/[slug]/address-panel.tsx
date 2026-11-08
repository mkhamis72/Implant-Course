import { domainStatus, vercelConfigured, type DomainStatus } from '@/lib/console/vercel';
import { AddDomainButton } from './forms';

const LABEL: Record<DomainStatus | 'unknown', { text: string; badge: string }> = {
  live: { text: 'Live', badge: 'badge-ok' },
  pending: { text: 'Waiting for DNS or certificate (usually 1–2 min)', badge: 'badge-warn' },
  missing: { text: 'Not added to Vercel', badge: 'badge-bad' },
  unknown: { text: 'Vercel could not be asked', badge: 'badge' },
};

/** Each address's state on Vercel, with a retry; without the Vercel settings, the manual steps. */
export async function AddressPanel({ slug, hosts }: { slug: string; hosts: string[] }) {
  if (!vercelConfigured()) {
    return (
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">Address</h2>
        <p className="mb-2 text-sm text-muted">Vercel isn’t connected to the console, so add each address by hand:</p>
        <ol className="list-decimal space-y-1 pl-5 text-sm">
          <li>Vercel → project <strong>implant-course</strong> → Settings → Domains → <strong>Add Existing</strong>: {hosts.join(', ')}.</li>
          <li>Only if the domain has no wildcard record: in GoDaddy add a CNAME for the name before the first dot, pointing to <code>cname.vercel-dns.com</code>.</li>
        </ol>
      </section>
    );
  }
  const statuses = await Promise.all(hosts.map((h) => domainStatus(h).catch(() => 'unknown' as const)));
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">Address</h2>
      <ul className="space-y-2">
        {hosts.map((host, i) => (
          <li key={host} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{host}</span>
            <span className={`badge ${LABEL[statuses[i]].badge}`}>{LABEL[statuses[i]].text}</span>
            {statuses[i] === 'missing' && <AddDomainButton slug={slug} host={host} />}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        A new address may show “not found” for up to a minute after it goes live. Addresses removed from the company stay on Vercel; they lead nowhere.
      </p>
    </section>
  );
}

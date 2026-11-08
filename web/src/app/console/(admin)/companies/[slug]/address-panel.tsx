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
  // On a refusal (wrong token or team), show Vercel's reason and keep the retry: adding may still work, and its error says more.
  const results = await Promise.all(
    hosts.map((h) =>
      domainStatus(h).then(
        (status) => ({ status, reason: '' }),
        (e: unknown) => ({ status: 'unknown' as const, reason: e instanceof Error ? e.message : '' }),
      ),
    ),
  );
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">Address</h2>
      <ul className="space-y-2">
        {hosts.map((host, i) => (
          <li key={host} className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{host}</span>
            <span className={`badge ${LABEL[results[i].status].badge}`}>{LABEL[results[i].status].text}</span>
            {(results[i].status === 'missing' || results[i].status === 'unknown') && <AddDomainButton slug={slug} host={host} />}
            {results[i].reason && <span className="w-full text-sm text-bad">{results[i].reason}</span>}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        A new address may show “not found” for up to a minute after it goes live. Addresses removed from the company stay on Vercel; they lead nowhere.
      </p>
    </section>
  );
}

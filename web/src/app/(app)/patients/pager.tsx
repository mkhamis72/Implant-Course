import Link from 'next/link';
import { pageHref, pageList, type ListFilters } from '@/lib/patients/pages';

/** Previous / page numbers / Next for the Patients list; every link keeps the search and filters. Hidden
 *  when everything fits on one page. */
export function Pager({ page, last, filters }: { page: number; last: number; filters: ListFilters }) {
  if (last <= 1) return null;
  const step = 'btn btn-secondary min-w-10 px-3';
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center gap-2">
      {page > 1 ? (
        <Link href={pageHref(filters, page - 1)} className={step} rel="prev">‹ Previous</Link>
      ) : (
        <span className={`${step} text-muted`} aria-disabled="true">‹ Previous</span>
      )}
      {pageList(page, last).map((p, i) =>
        p === '…' ? (
          <span key={`gap-${i}`} className="px-1 text-muted" aria-hidden="true">…</span>
        ) : p === page ? (
          <span key={p} className="btn min-w-10 px-3" aria-current="page">{p}</span>
        ) : (
          <Link key={p} href={pageHref(filters, p)} className={step} aria-label={`Page ${p}`}>{p}</Link>
        ),
      )}
      {page < last ? (
        <Link href={pageHref(filters, page + 1)} className={step} rel="next">Next ›</Link>
      ) : (
        <span className={`${step} text-muted`} aria-disabled="true">Next ›</span>
      )}
    </nav>
  );
}

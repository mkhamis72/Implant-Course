import Link from 'next/link';

/** "Date problem" marker; the count shows only above one. Renders nothing for zero. With `href` it is a link. */
export function DateProblemBadge({ count, title, href }: { count: number; title?: string; href?: string }) {
  if (count <= 0) return null;
  const label = count > 1 ? `Date problem (${count})` : 'Date problem';
  const badge = (
    <span className="badge-warn" title={title} data-testid="date-problem-badge">{label}</span>
  );
  return href ? <Link href={href}>{badge}</Link> : badge;
}

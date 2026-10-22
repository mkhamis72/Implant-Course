/** "Date problem" marker; the count shows only above one. Renders nothing for zero. */
export function DateProblemBadge({ count, title }: { count: number; title?: string }) {
  if (count <= 0) return null;
  return (
    <span className="badge-warn" title={title} data-testid="date-problem-badge">
      {count > 1 ? `Date problem (${count})` : 'Date problem'}
    </span>
  );
}

/** A dental implant fixture: the product's mark. */
export function Mark({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} aria-hidden="true">
      <rect width="24" height="24" rx="6" style={{ fill: 'var(--color-accent)' }} />
      <path d="M8 5.5h8v3H8z" style={{ fill: 'var(--color-surface)' }} />
      <path d="M9 10h6M9.5 13h5M10 16h4M11 19h2" style={{ stroke: 'var(--color-surface)' }} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

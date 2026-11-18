'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { href: '/schedule', label: 'Surgery' },
  { href: '/schedule/lectures', label: 'Lectures' },
  { href: '/schedule/workshops', label: 'Workshops' },
];

/** Schedule tabs; the selected day carries over when switching. A clinic has no lectures or workshops, so no tabs. */
export function ScheduleTabs({ teaching }: { teaching: boolean }) {
  const pathname = usePathname();
  const date = useSearchParams().get('date');
  if (!teaching) return null;
  return (
    <nav aria-label="Schedule sections" className="tabs print:hidden">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={date ? `${t.href}?date=${encodeURIComponent(date)}` : t.href}
          aria-current={pathname === t.href ? 'page' : undefined}
          className="tab"
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

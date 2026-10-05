'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

const TABS = [
  { href: '/schedule', label: 'Surgery' },
  { href: '/schedule/lectures', label: 'Lectures' },
  { href: '/schedule/workshops', label: 'Workshops' },
];

/** Schedule tabs; the selected day carries over when switching. */
export function ScheduleTabs() {
  const pathname = usePathname();
  const date = useSearchParams().get('date');
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

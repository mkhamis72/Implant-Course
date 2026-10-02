'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Tabs for the pages of one section; the current page is marked with aria-current. */
export function SectionNav({ label, items }: { label: string; items: { href: string; label: string }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="tabs print:hidden">
      {items.map((item) => (
        <Link key={item.href} href={item.href} aria-current={pathname === item.href ? 'page' : undefined} className="tab">
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function PatientTabs({ patientId }: { patientId: string }) {
  const pathname = usePathname();
  const base = `/patients/${patientId}`;
  const tabs = [
    { href: base, label: 'Chart' },
    { href: `${base}/overview`, label: 'Overview' },
    { href: `${base}/notes`, label: 'Notes' },
    { href: `${base}/history`, label: 'History' },
  ];
  return (
    <nav aria-label="Patient sections" className="flex gap-1 border-b border-gray-200">
      {tabs.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${active ? 'border-blue-700 font-medium text-blue-700' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}

'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The day buttons' row. On phones it scrolls sideways, so the chosen day (aria-current) is centred on load; from
 * the sm breakpoint it wraps and there's nothing to scroll. Scrolls the row only, never the page.
 */
export function DayRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const row = ref.current;
    const current = row?.querySelector<HTMLElement>('[aria-current]')?.closest('li');
    if (!row || !current || row.scrollWidth <= row.clientWidth) return;
    row.scrollLeft = current.offsetLeft - (row.clientWidth - current.offsetWidth) / 2;
  });
  return (
    <ul
      ref={ref}
      className="relative flex snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain pb-1 sm:flex-wrap sm:overflow-visible"
    >
      {children}
    </ul>
  );
}

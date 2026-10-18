'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActive, visibleNavItems, type Role } from './nav-items';
import type { Permissions } from '@/lib/auth/permissions';
import { signOut } from '@/app/actions/auth';
import { BrandMark } from './brand-mark';

function Wordmark({ brand }: { brand: { name: string; logoUrl: string | null } }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-nav-ink focus-visible:outline-nav-ink">
      <BrandMark logoUrl={brand.logoUrl} />
      <span className="leading-tight">{brand.name}</span>
    </Link>
  );
}

/**
 * One set of links: a fixed sidebar from 1024px, a slide-over panel opened from the top bar below that. Menu sits
 * on the left, where the panel slides in from (.nav-panel in globals.css).
 */
export function Nav({ role, permissions, name, brand }: { role: Role; permissions: Permissions; name: string; brand: { name: string; logoUrl: string | null } }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const menuButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  // While the slide-over is open it owns focus: the page behind is inert, and closing hands focus back to Menu.
  useEffect(() => {
    const main = document.querySelector('main');
    if (open) {
      main?.setAttribute('inert', '');
      panel.current?.querySelector<HTMLElement>('nav a')?.focus();
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
      window.addEventListener('keydown', onKey);
      wasOpen.current = true;
      return () => window.removeEventListener('keydown', onKey);
    }
    main?.removeAttribute('inert');
    if (wasOpen.current) {
      wasOpen.current = false;
      // After following a link the new page takes focus; only return it when the menu was simply closed.
      if (document.activeElement === document.body || panel.current?.contains(document.activeElement)) menuButton.current?.focus();
    }
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-nav-line bg-nav px-4 py-2.5 lg:hidden print:hidden">
        <button
          ref={menuButton}
          type="button"
          className="btn-secondary btn px-3 focus-visible:outline-nav-ink"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen(true)}
        >
          Menu
        </button>
        <Wordmark brand={brand} />
      </header>

      <div className="nav-scrim lg:hidden" data-open={open || undefined} onClick={() => setOpen(false)} aria-hidden="true" />

      <aside
        ref={panel}
        id="main-nav"
        data-open={open || undefined}
        className="nav-panel flex-col border-r border-nav-line bg-nav p-4 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 print:hidden"
      >
        <div className="mb-6 flex items-center justify-between gap-2">
          <Wordmark brand={brand} />
          {open && (
            <button type="button" className="btn-secondary btn px-3 focus-visible:outline-nav-ink lg:hidden" onClick={() => setOpen(false)}>
              Close
            </button>
          )}
        </div>
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
          {visibleNavItems({ role, permissions }).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-11 items-center rounded-md px-3 py-2 lg:min-h-0 focus-visible:outline-nav-ink ${
                  active ? 'bg-accent-soft font-semibold text-accent-strong' : 'text-nav-ink hover:bg-nav-hover'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-nav-line pt-4 text-sm">
          <div className="truncate px-3 font-medium text-nav-ink">{name}</div>
          <Link href="/account/security" onClick={() => setOpen(false)} className="block rounded-md px-3 py-1.5 text-nav-ink hover:bg-nav-hover focus-visible:outline-nav-ink">
            Account security
          </Link>
          <form action={signOut}>
            <button className="w-full rounded-md px-3 py-1.5 text-left text-nav-ink hover:bg-nav-hover focus-visible:outline-nav-ink">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}

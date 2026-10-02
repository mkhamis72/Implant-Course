'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActive, visibleNavItems, type Role } from './nav-items';
import { signOut } from '@/app/actions/auth';
import { Mark } from './mark';

function Wordmark() {
  return (
    <Link href="/" className="flex items-center gap-2.5 font-semibold tracking-tight text-ink">
      <Mark />
      <span className="leading-tight">Implant Course Manager</span>
    </Link>
  );
}

/**
 * One set of links: a fixed sidebar from 1024px, a slide-over panel opened from the top bar below that.
 */
export function Nav({ role, name }: { role: Role; name: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden print:hidden">
        <Wordmark />
        <button
          type="button"
          className="btn-secondary btn px-3"
          aria-expanded={open}
          aria-controls="main-nav"
          onClick={() => setOpen(true)}
        >
          Menu
        </button>
      </header>

      {open && <div className="fixed inset-0 z-40 bg-ink/30 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside
        id="main-nav"
        className={`${open ? 'fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] shadow-xl' : 'hidden'} flex-col border-r border-line bg-surface p-4 lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shadow-none print:hidden`}
      >
        <div className="mb-6 flex items-center justify-between gap-2">
          <Wordmark />
          {open && (
            <button type="button" className="btn-secondary btn px-3 lg:hidden" onClick={() => setOpen(false)}>
              Close
            </button>
          )}
        </div>
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
          {visibleNavItems(role).map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
                className={`rule flex min-h-11 items-center rounded-r-md py-2 pr-3 lg:min-h-0 ${
                  active ? 'rule-accent bg-accent-soft font-semibold text-accent-strong' : 'border-l-transparent text-ink hover:bg-sunken'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-1 border-t border-line pt-4 text-sm">
          <div className="truncate px-3 font-medium text-ink">{name}</div>
          <Link href="/account/security" onClick={() => setOpen(false)} className="block rounded-md px-3 py-1.5 text-muted hover:bg-sunken hover:text-ink">
            Account security
          </Link>
          <form action={signOut}>
            <button className="w-full rounded-md px-3 py-1.5 text-left text-muted hover:bg-sunken hover:text-ink">Sign out</button>
          </form>
        </div>
      </aside>
    </>
  );
}

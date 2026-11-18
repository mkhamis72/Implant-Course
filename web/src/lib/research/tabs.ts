import type { Profile } from '@/lib/auth/session';

/** The Statistics section tabs: no Courses tab in a clinic, Recent exports for admins. */
export function statisticsTabs(role: Profile['role'], teaching: boolean): { href: string; label: string }[] {
  return [
    { href: '/statistics', label: 'Results' },
    { href: '/statistics/explore', label: 'Explore' },
    ...(teaching ? [{ href: '/statistics/courses', label: 'Courses' }] : []),
    { href: '/statistics/studies', label: 'Studies' },
    ...(role === 'admin' ? [{ href: '/statistics/exports', label: 'Recent exports' }] : []),
  ];
}

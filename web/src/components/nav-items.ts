import { canView, type Area, type Permissions, type Role } from '@/lib/auth/permissions';

export type { Role };

export type NavItem = { href: string; label: string; adminOnly?: boolean; area?: Area };

// Keep Admin last.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/patients', label: 'Patients', area: 'patients' },
  { href: '/schedule', label: 'Schedule', area: 'schedule' },
  { href: '/courses', label: 'Courses', area: 'courses' },
  { href: '/checklists', label: 'Checklists', area: 'checklists' },
  { href: '/inventory', label: 'Inventory', area: 'inventory' },
  { href: '/delegates', label: 'Delegates', area: 'delegates' },
  { href: '/statistics', label: 'Statistics', area: 'research' },
  { href: '/admin/users', label: 'Admin', adminOnly: true },
];

/** A delegate login sees only its own pages. */
export const DELEGATE_NAV: NavItem[] = [
  { href: '/my', label: 'My schedule' },
  { href: '/my/report', label: 'My report' },
  { href: '/account/security', label: 'Account security' },
];

export function visibleNavItems(p: { role: Role; permissions: Permissions }): NavItem[] {
  if (p.role === 'delegate') return DELEGATE_NAV;
  return NAV_ITEMS.filter((item) => (item.adminOnly ? p.role === 'admin' : !item.area || canView(p, item.area)));
}

/** True when `pathname` is inside the nav item's section (its first path segment). */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  const section = href.split('/')[1];
  return pathname.split('/')[1] === section;
}

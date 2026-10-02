export type Role = 'admin' | 'organizer';

export type NavItem = { href: string; label: string; adminOnly?: boolean };

// Later plans add entries here (Patients, Schedule, Inventory, ...), keeping Admin last.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/patients', label: 'Patients' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/courses', label: 'Courses' },
  { href: '/checklists', label: 'Checklists' },
  { href: '/inventory', label: 'Inventory' },
  { href: '/delegates', label: 'Delegates' },
  { href: '/admin/users', label: 'Admin', adminOnly: true },
];

export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
}

/** True when `pathname` is inside the nav item's section (its first path segment). */
export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  const section = href.split('/')[1];
  return pathname.split('/')[1] === section;
}

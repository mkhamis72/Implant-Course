export type Role = 'admin' | 'organizer';

export type NavItem = { href: string; label: string; adminOnly?: boolean };

// Later plans add entries here (Patients, Schedule, Inventory, ...), keeping Admin last.
export const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Dashboard' },
  { href: '/admin/users', label: 'Admin', adminOnly: true },
];

export function visibleNavItems(role: Role): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || role === 'admin');
}

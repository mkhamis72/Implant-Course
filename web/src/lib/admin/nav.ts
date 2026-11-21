import { teachingOn, type Feature } from '@/lib/modules/modules';

/** Admin section tabs: Supervisors and Lecturers belong to teaching only; Catalogue (0128) is in every plan. */
export function adminNavItems(features: readonly Feature[]): { href: string; label: string }[] {
  return [
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/settings', label: 'Settings' },
    { href: '/admin/chairs', label: 'Chairs' },
    { href: '/admin/doctors', label: 'Doctors' },
    { href: '/admin/catalogue', label: 'Catalogue' },
    ...(teachingOn(features)
      ? [
          { href: '/admin/supervisors', label: 'Supervisors' },
          { href: '/admin/lecturers', label: 'Lecturers' },
        ]
      : []),
  ];
}

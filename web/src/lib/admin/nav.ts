import { teachingOn, type Feature } from '@/lib/modules/modules';

/** Admin section tabs: Supervisors and Lecturers belong to teaching only. */
export function adminNavItems(features: readonly Feature[]): { href: string; label: string }[] {
  return [
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/settings', label: 'Settings' },
    { href: '/admin/chairs', label: 'Chairs' },
    { href: '/admin/doctors', label: 'Doctors' },
    ...(teachingOn(features)
      ? [
          { href: '/admin/supervisors', label: 'Supervisors' },
          { href: '/admin/lecturers', label: 'Lecturers' },
        ]
      : []),
  ];
}

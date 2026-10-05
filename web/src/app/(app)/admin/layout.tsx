import { requireAdmin } from '@/lib/auth/session';
import { SectionNav } from '@/components/section-nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <SectionNav
        label="Admin sections"
        items={[
          { href: '/admin/users', label: 'Users' },
          { href: '/admin/settings', label: 'Settings' },
          { href: '/admin/chairs', label: 'Chairs' },
          { href: '/admin/supervisors', label: 'Supervisors' },
          { href: '/admin/lecturers', label: 'Lecturers' },
        ]}
      />
      {children}
    </div>
  );
}

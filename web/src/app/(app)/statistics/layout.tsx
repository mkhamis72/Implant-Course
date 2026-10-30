import { SectionNav } from '@/components/section-nav';
import { requirePermission } from '@/lib/auth/session';

export default async function StatisticsLayout({ children }: { children: React.ReactNode }) {
  const profile = await requirePermission('research');
  return (
    <div className="space-y-6">
      <SectionNav
        label="Statistics sections"
        items={[
          { href: '/statistics', label: 'Results' },
          { href: '/statistics/explore', label: 'Explore' },
          { href: '/statistics/courses', label: 'Courses' },
          { href: '/statistics/studies', label: 'Studies' },
          ...(profile.role === 'admin' ? [{ href: '/statistics/exports', label: 'Recent exports' }] : []),
        ]}
      />
      {children}
    </div>
  );
}

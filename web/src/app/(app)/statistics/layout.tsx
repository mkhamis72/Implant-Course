import { SectionNav } from '@/components/section-nav';
import { requirePermission } from '@/lib/auth/session';
import { teachingOn } from '@/lib/modules/modules';
import { statisticsTabs } from '@/lib/research/tabs';

export default async function StatisticsLayout({ children }: { children: React.ReactNode }) {
  const profile = await requirePermission('research');
  return (
    <div className="space-y-6">
      <SectionNav
        label="Statistics sections"
        items={statisticsTabs(profile.role, teachingOn(profile.features))}
      />
      {children}
    </div>
  );
}

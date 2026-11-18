import { requireAdmin } from '@/lib/auth/session';
import { SectionNav } from '@/components/section-nav';
import { adminNavItems } from '@/lib/admin/nav';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireAdmin();
  return (
    <div className="space-y-6">
      <SectionNav label="Admin sections" items={adminNavItems(profile.features)} />
      {children}
    </div>
  );
}

import { getCurrentProfile } from '@/lib/auth/session';
import { teachingOn } from '@/lib/modules/modules';
import { ScheduleTabs } from './schedule-tabs';

export default async function ScheduleLayout({ children }: { children: React.ReactNode }) {
  // Pages guard themselves; without a profile the tabs stay (the page redirects anyway).
  const profile = await getCurrentProfile();
  return (
    <div className="space-y-6">
      <ScheduleTabs teaching={!profile || teachingOn(profile.features)} />
      {children}
    </div>
  );
}

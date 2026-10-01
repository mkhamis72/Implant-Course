import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { IdleTimer } from '@/components/idle-timer';
import { getCurrentProfile, getSettings } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  const settings = await getSettings();
  return (
    <div className="flex min-h-screen">
      <Nav role={profile.role} name={profile.full_name || profile.email} />
      <main className="flex-1 p-6">{children}</main>
      <IdleTimer timeoutMinutes={settings.session_timeout_minutes} />
    </div>
  );
}

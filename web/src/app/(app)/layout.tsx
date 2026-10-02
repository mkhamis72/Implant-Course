import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { IdleTimer } from '@/components/idle-timer';
import { getCurrentProfile, getSettings } from '@/lib/auth/session';
import { PilotBanner } from '@/components/pilot-banner';
import { pilotMode } from '@/lib/flags';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  const settings = await getSettings();
  return (
    <div className="min-h-screen lg:flex">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-ink px-4 py-2 font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <Nav role={profile.role} name={profile.full_name || profile.email} />
      <main id="main" tabIndex={-1} className="min-w-0 flex-1 px-4 py-5 outline-none sm:px-6 lg:px-10 lg:py-8 print:p-0">
        <div className="mx-auto max-w-6xl">
          <PilotBanner show={pilotMode()} />
          {children}
        </div>
      </main>
      <IdleTimer timeoutMinutes={settings.session_timeout_minutes} />
    </div>
  );
}

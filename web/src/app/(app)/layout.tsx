import { redirect } from 'next/navigation';
import { Nav } from '@/components/nav';
import { getCurrentProfile } from '@/lib/auth/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect('/login');
  if (!profile.active) redirect('/deactivated');
  return (
    <div className="flex min-h-screen">
      <Nav role={profile.role} name={profile.full_name || profile.email} />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}

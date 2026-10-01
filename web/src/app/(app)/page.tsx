import { getCurrentProfile } from '@/lib/auth/session';

export default async function DashboardPage() {
  const profile = await getCurrentProfile();
  return (
    <div className="space-y-2">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-gray-600">Welcome, {profile?.full_name || profile?.email}.</p>
    </div>
  );
}

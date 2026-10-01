import Link from 'next/link';
import { requireAdmin } from '@/lib/auth/session';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="space-y-6">
      <nav className="flex gap-4 border-b border-gray-200 pb-2 text-sm">
        <Link href="/admin/users" className="hover:underline">Users</Link>
        <Link href="/admin/settings" className="hover:underline">Settings</Link>
      </nav>
      {children}
    </div>
  );
}

import Link from 'next/link';
import { visibleNavItems, type Role } from './nav-items';
import { signOut } from '@/app/actions/auth';

export function Nav({ role, name }: { role: Role; name: string }) {
  return (
    <aside className="flex w-56 flex-col border-r border-gray-200 bg-white p-4">
      <div className="mb-6 font-semibold">Implant Course Manager</div>
      <nav className="flex flex-1 flex-col gap-1">
        {visibleNavItems(role).map((item) => (
          <Link key={item.href} href={item.href} className="rounded px-2 py-1.5 hover:bg-gray-100">
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-2 border-t border-gray-200 pt-4 text-sm">
        <div className="truncate text-gray-600">{name}</div>
        <Link href="/account/security" className="block hover:underline">
          Account security
        </Link>
        <form action={signOut}>
          <button className="text-left hover:underline">Sign out</button>
        </form>
      </div>
    </aside>
  );
}

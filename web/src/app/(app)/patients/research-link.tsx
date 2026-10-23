import Link from 'next/link';
import { canView, type Permissions, type Role } from '@/lib/auth/permissions';

/** "Research" on the patients list, only for users who may open the research page. */
export function ResearchLink({ profile }: { profile: { role: Role; permissions: Permissions } }) {
  if (!canView(profile, 'research')) return null;
  return <Link href="/patients/research" className="btn-secondary btn">Research</Link>;
}

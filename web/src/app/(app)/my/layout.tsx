import { getCurrentProfile } from '@/lib/auth/session';
import { teachingOn } from '@/lib/modules/modules';

/** A clinic has no teaching: the delegate pages show nothing (the pages still guard themselves). */
export default async function MyLayout({ children }: { children: React.ReactNode }) {
  const profile = await getCurrentProfile();
  if (profile && !teachingOn(profile.features)) {
    return <p className="text-muted">This page is not available for your organisation.</p>;
  }
  return <>{children}</>;
}

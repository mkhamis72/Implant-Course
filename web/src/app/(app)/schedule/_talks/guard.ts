import { redirect } from 'next/navigation';
import { requirePermission, type Profile } from '@/lib/auth/session';
import type { Level } from '@/lib/auth/permissions';
import { teachingOn } from '@/lib/modules/modules';

/** Lectures and workshops pages: Schedule access, and only for a course organizer (a clinic goes to /schedule). */
export async function requireTalks(level: Level = 'view'): Promise<Profile> {
  const profile = await requirePermission('schedule', level);
  if (!teachingOn(profile.features)) redirect('/schedule');
  return profile;
}

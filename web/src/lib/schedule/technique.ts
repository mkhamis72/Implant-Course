import type { Technique } from '@/lib/inventory/types';

export type BookingTechnique = Technique | 'mixed';

/** One technique for the whole booking, 'mixed' when its implants differ, null when none is known. */
export function bookingTechnique(implants: { site: { technique: Technique | null } | null }[]): BookingTechnique | null {
  const known = new Set(implants.map((i) => i.site?.technique).filter((t): t is Technique => !!t));
  if (known.size === 0) return null;
  return known.size > 1 ? 'mixed' : [...known][0];
}

export const TECHNIQUE_SHORT: Record<Technique, string> = { guided: 'G', free_hand: 'FH' };

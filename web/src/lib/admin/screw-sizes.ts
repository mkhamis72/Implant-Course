import { z } from 'zod';

export const SCREW_KINDS = ['abutment_screw', 'prosthetic_screw'] as const;
export type ScrewKind = (typeof SCREW_KINDS)[number];
export const SCREW_KIND_LABELS: Record<ScrewKind, string> = { abutment_screw: 'Abutment screw', prosthetic_screw: 'Prosthetic screw' };

/** One row of public.screw_sizes (0148). */
export type ScrewSize = {
  id: string;
  brand: string;
  system: string;
  kind: 'abutment_screw' | 'prosthetic_screw';
  label: string;
  driver_interface: string;
  driver_size: string;
  driver_ref: string;
  torque_ncm: number | null;
  active: boolean;
};

/** "Screwdriver Hex 1.25 · ref SD-1 · Recommended torque 25 Ncm"; parts that are empty are left out. */
export function screwDriverLine(s: ScrewSize): string {
  const driver = [s.driver_interface, s.driver_size].map((p) => p.trim()).filter(Boolean).join(' ');
  return [
    driver ? `Screwdriver ${driver}` : '',
    s.driver_ref.trim() ? `ref ${s.driver_ref.trim()}` : '',
    s.torque_ncm != null ? `Recommended torque ${s.torque_ncm} Ncm` : '',
  ].filter(Boolean).join(' · ');
}

/** The brand and system in one form value (a select's option). */
export const SYSTEM_SEP = '\u001f';
export const systemKey = (brand: string, system: string) => `${brand}${SYSTEM_SEP}${system}`;

const text = (max: number, message: string) => z.string().trim().max(max, { message });

export const screwSizeSchema = z.object({
  id: z.union([z.literal(''), z.string().uuid()]).default(''),
  system: z.string().refine((v) => {
    const [brand, system, ...rest] = v.split(SYSTEM_SEP);
    return rest.length === 0 && !!brand?.trim() && !!system?.trim();
  }, { message: 'Choose the implant system.' }),
  kind: z.enum(SCREW_KINDS, { message: 'Choose abutment screw or prosthetic screw.' }),
  label: z.string().trim().min(1, { message: 'Enter the screw size.' }).max(40, { message: 'Keep the size under 40 characters.' }),
  driver_interface: text(60, 'Keep the screwdriver interface under 60 characters.'),
  driver_size: text(30, 'Keep the screwdriver size under 30 characters.'),
  driver_ref: text(60, 'Keep the screwdriver ref under 60 characters.'),
  torque: z.string().trim().transform((v, ctx) => {
    if (v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 150) {
      ctx.addIssue({ code: 'custom', message: 'Torque must be between 0 and 150 Ncm.' });
      return z.NEVER;
    }
    return Math.round(n * 10) / 10;
  }),
}).transform((v) => {
  const [brand, system] = v.system.split(SYSTEM_SEP);
  return { ...v, brand: brand.trim(), system: system.trim() };
});

export type ScrewSizeInput = z.output<typeof screwSizeSchema>;

/** Sizes grouped by brand and system; within a group abutment screws come before prosthetic screws. */
export function groupScrewSizes(list: ScrewSize[]): { brand: string; system: string; sizes: ScrewSize[] }[] {
  const groups = new Map<string, { brand: string; system: string; sizes: ScrewSize[] }>();
  for (const s of list) {
    const key = systemKey(s.brand, s.system);
    const g = groups.get(key) ?? { brand: s.brand, system: s.system, sizes: [] };
    g.sizes.push(s);
    groups.set(key, g);
  }
  const rank = (k: ScrewKind) => SCREW_KINDS.indexOf(k);
  return [...groups.values()]
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.system.localeCompare(b.system))
    .map((g) => ({
      ...g,
      sizes: [...g.sizes].sort((a, b) => rank(a.kind) - rank(b.kind) || a.label.localeCompare(b.label, undefined, { numeric: true })),
    }));
}

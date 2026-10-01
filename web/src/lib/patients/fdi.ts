export const CHART_ORDER = {
  upper: [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28],
  lower: [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38],
} as const;

export type ToothType = 'incisor' | 'canine' | 'premolar' | 'molar';

export function isFdiTooth(n: number): boolean {
  const quadrant = Math.floor(n / 10);
  const position = n % 10;
  return Number.isInteger(n) && quadrant >= 1 && quadrant <= 4 && position >= 1 && position <= 8;
}

export function toothType(fdi: number): ToothType {
  const position = fdi % 10;
  if (position <= 2) return 'incisor';
  if (position === 3) return 'canine';
  if (position <= 5) return 'premolar';
  return 'molar';
}

/** Parses "36, 46" / "36 46" / "36;46" into sorted unique FDI teeth. */
export function parseTeeth(input: string): { teeth: number[] } | { error: string } {
  const teeth = new Set<number>();
  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    const n = Number(token);
    if (!/^\d+$/.test(token) || !isFdiTooth(n)) {
      return { error: `"${token}" is not a tooth number. Use FDI numbers 11–48 (e.g. 36, 46).` };
    }
    teeth.add(n);
  }
  return { teeth: [...teeth].sort((a, b) => a - b) };
}

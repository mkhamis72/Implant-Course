import type { ToothType } from '@/lib/patients/fdi';

type Shape = { crown: string; roots: string };

// Upper-jaw frame: roots point up (y 0–80), crown below (y 80–130), width 40.
const CROWNS: Record<ToothType, string> = {
  incisor: 'M10 80 L30 80 Q33 105 28 126 Q20 131 12 126 Q7 105 10 80 Z',
  canine: 'M9 80 L31 80 Q34 102 20 130 Q6 102 9 80 Z',
  premolar: 'M7 80 L33 80 Q37 100 32 124 Q20 130 8 124 Q3 100 7 80 Z',
  molar: 'M2 80 L38 80 Q42 100 37 124 Q28 130 20 126 Q12 130 3 124 Q-2 100 2 80 Z',
};

const ROOTS: Record<ToothType, { upper: string; lower: string }> = {
  incisor: {
    upper: 'M14 80 L17 8 Q20 2 23 8 L26 80 Z',
    lower: 'M15 80 L18 10 Q20 5 22 10 L25 80 Z',
  },
  canine: {
    upper: 'M14 80 L18 0 Q20 -4 22 0 L26 80 Z',
    lower: 'M14 80 L18 4 Q20 0 22 4 L26 80 Z',
  },
  premolar: {
    upper: 'M13 80 L17 12 Q20 6 23 12 L27 80 Z',
    lower: 'M13 80 L17 10 Q20 4 23 10 L27 80 Z',
  },
  molar: {
    upper: 'M5 80 L8 22 Q10 16 12 22 L16 80 Z M16 80 L19 14 Q21 8 23 14 L25 80 Z M25 80 L29 22 Q31 16 33 22 L36 80 Z',
    lower: 'M6 80 L10 18 Q12 12 14 18 L18 80 Z M22 80 L26 18 Q28 12 30 18 L34 80 Z',
  },
};

export function toothShape(type: ToothType, jaw: 'upper' | 'lower'): Shape {
  return { crown: CROWNS[type], roots: ROOTS[type][jaw] };
}

import { CHART_ORDER, toothType, type ToothType } from '@/lib/patients/fdi';

export const TOOTH_W = 40;
export const TOOTH_H = 130;
export const JAW_GAP = 46;
const GAP = 6;
const MIDLINE_GAP = 28;

export const CHART_WIDTH = 16 * TOOTH_W + 14 * GAP + MIDLINE_GAP;
export const CHART_HEIGHT = 2 * TOOTH_H + JAW_GAP;
export const MIDLINE_X = 8 * TOOTH_W + 7 * GAP + MIDLINE_GAP / 2;

export type ToothBox = { fdi: number; jaw: 'upper' | 'lower'; type: ToothType; x: number; y: number };

export function toothLayout(): ToothBox[] {
  const boxes: ToothBox[] = [];
  for (const jaw of ['upper', 'lower'] as const) {
    CHART_ORDER[jaw].forEach((fdi, i) => {
      const x = i < 8 ? i * (TOOTH_W + GAP) : MIDLINE_X + MIDLINE_GAP / 2 + (i - 8) * (TOOTH_W + GAP);
      boxes.push({ fdi, jaw, type: toothType(fdi), x, y: jaw === 'upper' ? 0 : TOOTH_H + JAW_GAP });
    });
  }
  return boxes;
}

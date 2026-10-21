import { CHART_ORDER, toothType, type ToothType } from '@/lib/patients/fdi';

export const TOOTH_W = 40;
export const TOOTH_H = 130;
// Room in the gap for each jaw's tooth numbers and a restoration bar on its side of the jaw line.
export const JAW_GAP = 78;
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

const LAYOUT = toothLayout();

/** Height of a restoration bar. */
export const SPAN_H = 12;
/** Space between a bar and the jaw line. */
const SPAN_TO_LINE = 4;

/** The bar under the teeth a restoration covers: from the first box to the last, on the jaw's side of the jaw line. */
export function spanBox(teeth: number[]): { x: number; y: number; width: number; jaw: 'upper' | 'lower' } {
  const boxes = LAYOUT.filter((b) => teeth.includes(b.fdi));
  const x = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x)) + TOOTH_W;
  const jaw = boxes[0]?.jaw ?? 'upper';
  const line = TOOTH_H + JAW_GAP / 2;
  const y = jaw === 'upper' ? line - SPAN_TO_LINE - SPAN_H : line + SPAN_TO_LINE;
  return { x, y, width: right - x, jaw };
}


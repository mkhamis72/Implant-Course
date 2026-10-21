import { describe, it, expect } from 'vitest';
import { CHART_HEIGHT, CHART_WIDTH, JAW_GAP, MIDLINE_X, SPAN_H, TOOTH_H, TOOTH_W, spanBox, toothLayout } from './layout';

describe('toothLayout', () => {
  const boxes = toothLayout();
  const byFdi = new Map(boxes.map((b) => [b.fdi, b]));

  it('has 32 unique teeth', () => {
    expect(new Set(boxes.map((b) => b.fdi)).size).toBe(32);
  });
  it('places the upper jaw on top and the lower jaw below the gap', () => {
    expect(byFdi.get(11)!.y).toBe(0);
    expect(byFdi.get(41)!.y).toBe(TOOTH_H + JAW_GAP);
    expect(byFdi.get(11)!.jaw).toBe('upper');
    expect(byFdi.get(36)!.jaw).toBe('lower');
  });
  it('runs 18→11 | 21→28 and 48→41 | 31→38 left to right, split at the midline', () => {
    expect(byFdi.get(18)!.x).toBe(0);
    expect(byFdi.get(48)!.x).toBe(0);
    expect(byFdi.get(11)!.x + TOOTH_W).toBeLessThan(MIDLINE_X);
    expect(byFdi.get(21)!.x).toBeGreaterThan(MIDLINE_X);
    expect(byFdi.get(31)!.x).toBe(byFdi.get(21)!.x);
    expect(byFdi.get(28)!.x + TOOTH_W).toBe(CHART_WIDTH);
    expect(CHART_HEIGHT).toBe(2 * TOOTH_H + JAW_GAP);
  });
  it('knows each tooth’s type', () => {
    expect(byFdi.get(13)!.type).toBe('canine');
    expect(byFdi.get(46)!.type).toBe('molar');
  });
});

describe('spanBox', () => {
  const byFdi = new Map(toothLayout().map((b) => [b.fdi, b]));

  it('spans exactly the covered teeth’s boxes, in the jaw gap', () => {
    const box = spanBox([34, 35, 36]);
    expect(box.jaw).toBe('lower');
    expect(box.x).toBe(byFdi.get(34)!.x);
    expect(box.x + box.width).toBe(byFdi.get(36)!.x + TOOTH_W);
    expect(box.y).toBeGreaterThan(TOOTH_H + JAW_GAP / 2);
    expect(box.y + SPAN_H).toBeLessThan(byFdi.get(34)!.y);
  });

  it('crosses the midline for a full arch and sits above the jaw line in the upper jaw', () => {
    const box = spanBox([15, 14, 13, 12, 11, 21, 22, 23, 24, 25]);
    expect(box.jaw).toBe('upper');
    expect(box.x).toBe(byFdi.get(15)!.x);
    expect(box.x + box.width).toBe(byFdi.get(25)!.x + TOOTH_W);
    expect(box.y).toBeGreaterThan(TOOTH_H);
    expect(box.y + SPAN_H).toBeLessThan(TOOTH_H + JAW_GAP / 2);
  });
});

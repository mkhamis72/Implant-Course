export const GRID_START = 7 * 60;
export const GRID_END = 20 * 60;
export const SLOT_MINUTES = 15;
const ROWS = (GRID_END - GRID_START) / SLOT_MINUTES;

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 1-based CSS grid row and span for a booking; partial quarters round outward; clamped to the grid. */
export function gridPlacement(start: string, end: string): { row: number; span: number } {
  const s = Math.max(GRID_START, Math.min(GRID_END - SLOT_MINUTES, minutesOfDay(start)));
  const e = Math.min(GRID_END, Math.max(s + SLOT_MINUTES, minutesOfDay(end)));
  const first = Math.floor((s - GRID_START) / SLOT_MINUTES);
  const lastExclusive = Math.ceil((e - GRID_START) / SLOT_MINUTES);
  return { row: first + 1, span: Math.max(1, Math.min(ROWS, lastExclusive) - first) };
}

export function timeLabels(): string[] {
  return Array.from({ length: ROWS }, (_, i) => {
    const m = GRID_START + i * SLOT_MINUTES;
    return m % 60 === 0 ? `${String(m / 60).padStart(2, '0')}:00` : '';
  });
}

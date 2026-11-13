/** The hours the schedule grid shows on a day with no earlier or later booking. */
export const GRID_START = 7 * 60;
export const GRID_END = 20 * 60;
export const SLOT_MINUTES = 15;
const DAY_END = 24 * 60;

/** The hours the grid shows, in minutes of the day. */
export type GridRange = { start: number; end: number };

export function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** A booking that ends at or before its start runs past midnight: it ends with the day. */
function endOf(start: number, end: number): number {
  return end <= start ? DAY_END : end;
}

/** 07:00–20:00, stretched to the full hours that hold every booking of the day. */
export function gridRange(bookings: { start: number; end: number }[]): GridRange {
  let start = GRID_START;
  let end = GRID_END;
  for (const b of bookings) {
    start = Math.min(start, Math.floor(b.start / 60) * 60);
    end = Math.max(end, Math.ceil(endOf(b.start, b.end) / 60) * 60);
  }
  return { start: Math.max(0, start), end: Math.min(DAY_END, end) };
}

/** 1-based CSS grid row and span for a booking; partial quarters round outward; clamped to the grid. */
export function gridPlacement(start: string, end: string, range: GridRange): { row: number; span: number } {
  const rows = (range.end - range.start) / SLOT_MINUTES;
  const from = minutesOfDay(start);
  const s = Math.max(range.start, Math.min(range.end - SLOT_MINUTES, from));
  const e = Math.min(range.end, Math.max(s + SLOT_MINUTES, endOf(from, minutesOfDay(end))));
  const first = Math.floor((s - range.start) / SLOT_MINUTES);
  const lastExclusive = Math.ceil((e - range.start) / SLOT_MINUTES);
  return { row: first + 1, span: Math.max(1, Math.min(rows, lastExclusive) - first) };
}

export function timeLabels(range: GridRange): string[] {
  const rows = (range.end - range.start) / SLOT_MINUTES;
  return Array.from({ length: rows }, (_, i) => {
    const m = range.start + i * SLOT_MINUTES;
    return m % 60 === 0 ? `${String(m / 60).padStart(2, '0')}:00` : '';
  });
}

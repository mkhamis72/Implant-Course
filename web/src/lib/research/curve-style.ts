/** Colours and dash patterns for survival curves. Non-status tokens only: red/green/amber mean failure/ok/planned here. */
export const CURVE_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--color-series-${n})`);
const DASHES = [undefined, '7 4', '2 3', '10 3 2 3', '4 4', '12 5'];

export function curveStyle(i: number): { color: string; dash?: string } {
  return { color: CURVE_COLORS[i % CURVE_COLORS.length], dash: DASHES[i % DASHES.length] };
}

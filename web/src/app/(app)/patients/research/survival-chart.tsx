// Kaplan–Meier step curve as inline SVG (no chart library, design tokens only). Display only: the points come from
// kaplanMeier() over the statuses SQL returned.

type Point = { month: number; survival: number };

const W = 640;
const H = 270;
const L = 48;
const R = 16;
const T = 12;
const PLOT_B = 200; // bottom of the plot area
const AXIS_LABEL_Y = PLOT_B + 18;
const RISK_TITLE_Y = PLOT_B + 44;
const RISK_Y = PLOT_B + 62;

export function SurvivalChart({ points, atRisk, endMonth }: {
  points: Point[];
  atRisk: { month: number; n: number }[];
  /** Longest follow-up among the plotted implants, in months: the curve runs to here. */
  endMonth: number;
}) {
  const xMax = Math.max(24, Math.ceil(endMonth / 12) * 12);
  const xStep = xMax > 72 ? 24 : 12;
  const minS = Math.min(...points.map((p) => p.survival));
  const yMin = Math.min(0.8, Math.floor(minS * 10) / 10);
  const range = 1 - yMin;
  const yStep = range <= 0.2 ? 0.05 : range <= 0.5 ? 0.1 : 0.2;

  const x = (m: number) => L + (m / xMax) * (W - L - R);
  const y = (s: number) => T + ((1 - s) / range) * (PLOT_B - T);

  let d = `M${x(0)},${y(1)}`;
  for (const p of points.slice(1)) d += ` H${x(p.month).toFixed(1)} V${y(p.survival).toFixed(1)}`;
  d += ` H${x(Math.max(endMonth, points[points.length - 1].month)).toFixed(1)}`;

  const xTicks: number[] = [];
  for (let m = 0; m <= xMax; m += xStep) xTicks.push(m);
  const yTicks: number[] = [];
  for (let s = 1; s >= yMin - 1e-9; s -= yStep) yTicks.push(Math.round(s * 1000) / 1000);
  const last = points[points.length - 1].survival;

  return (
    <div className="overflow-x-auto">
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[32rem]" role="img"
      aria-label={`Survival curve: ${(last * 100).toFixed(1)}% at ${Math.round(endMonth)} months. Number at risk: ${atRisk.map((a) => `${a.n} at ${a.month} months`).join(', ')}.`}>
      <g fontSize="12" fill="var(--color-muted)">
        {yTicks.map((s) => (
          <g key={`y${s}`}>
            <line x1={L} x2={W - R} y1={y(s)} y2={y(s)} stroke="var(--color-line)" />
            <text x={L - 6} y={y(s) + 4} textAnchor="end">{`${Math.round(s * 100)}%`}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={PLOT_B} y2={PLOT_B} stroke="var(--color-line-strong)" />
        {xTicks.map((m) => (
          <text key={`x${m}`} x={x(m)} y={AXIS_LABEL_Y} textAnchor="middle">{m}</text>
        ))}
        <text x={W - R} y={AXIS_LABEL_Y + 14} textAnchor="end">Months since placement</text>
      </g>
      <path d={d} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" strokeLinejoin="round" />
      <g fontSize="12">
        <text x={L} y={RISK_TITLE_Y} fill="var(--color-muted)">Number at risk</text>
        {atRisk.map((a) => (
          <text key={`r${a.month}`} x={x(a.month)} y={RISK_Y} textAnchor="middle" fill="var(--color-ink)">{a.n}</text>
        ))}
      </g>
    </svg>
    </div>
  );
}

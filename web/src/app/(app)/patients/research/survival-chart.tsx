// Kaplan–Meier step curves as inline SVG (no chart library, design tokens only). Display only: the points and the
// 95% CI band come from kaplanMeier() over the statuses SQL returned.

type Point = { month: number; survival: number };
type BandPoint = { month: number; lower: number | null; upper: number | null };

export type Curve = {
  label: string;
  /** A design-token colour, e.g. `var(--color-accent)`. */
  color: string;
  /** SVG dash pattern; omitted = solid. */
  dash?: string;
  points: Point[];
  /** Longest follow-up in this curve, in months: the line runs to here. */
  end: number;
};

const W = 640;
const H = 270;
const L = 48;
const R = 16;
const T = 12;
const PLOT_B = 200; // bottom of the plot area
const AXIS_LABEL_Y = PLOT_B + 18;
const RISK_TITLE_Y = PLOT_B + 44;
const RISK_Y = PLOT_B + 62;

export function SurvivalChart({ curves, band = [], atRisk, endMonth }: {
  curves: Curve[];
  /** The 95% CI from each event of a single curve; drawn as a shaded step band where it can be estimated. */
  band?: BandPoint[];
  atRisk: { month: number; n: number }[];
  /** Longest follow-up among the plotted implants, in months. */
  endMonth: number;
}) {
  const xMax = Math.max(24, Math.ceil(endMonth / 12) * 12);
  const xStep = xMax > 72 ? 24 : 12;
  const lows = [
    ...curves.flatMap((c) => c.points.map((p) => p.survival)),
    ...band.flatMap((b) => (b.lower === null ? [] : [b.lower])),
  ];
  const minS = Math.min(...lows);
  const yMin = Math.min(0.8, Math.floor(minS * 10) / 10);
  const range = 1 - yMin;
  const yStep = range <= 0.2 ? 0.05 : range <= 0.5 ? 0.1 : 0.2;

  const x = (m: number) => L + (m / xMax) * (W - L - R);
  const y = (s: number) => T + ((1 - s) / range) * (PLOT_B - T);

  const path = (c: Curve) => {
    let d = `M${x(0)},${y(1)}`;
    for (const p of c.points.slice(1)) d += ` H${x(p.month).toFixed(1)} V${y(p.survival).toFixed(1)}`;
    return d + ` H${x(Math.max(c.end, c.points[c.points.length - 1].month)).toFixed(1)}`;
  };

  // The band is a step function: one rectangle per event, up to the next event (or the end of follow-up).
  let bandPath = '';
  band.forEach((b, i) => {
    if (b.lower === null || b.upper === null) return;
    const to = i + 1 < band.length ? band[i + 1].month : Math.max(endMonth, b.month);
    if (to <= b.month) return;
    bandPath += `M${x(b.month).toFixed(1)},${y(b.upper).toFixed(1)} H${x(to).toFixed(1)} V${y(b.lower).toFixed(1)} H${x(b.month).toFixed(1)} Z `;
  });

  const xTicks: number[] = [];
  for (let m = 0; m <= xMax; m += xStep) xTicks.push(m);
  const yTicks: number[] = [];
  for (let s = 1; s >= yMin - 1e-9; s -= yStep) yTicks.push(Math.round(s * 1000) / 1000);
  const lastOf = (c: Curve) => `${(c.points[c.points.length - 1].survival * 100).toFixed(1)}% at ${Math.round(c.end)} months`;
  const summary = curves.length === 1
    ? `Survival curve: ${lastOf(curves[0])}.`
    : `Survival curves: ${curves.map((c) => `${c.label} ${lastOf(c)}`).join('; ')}.`;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[32rem]" role="img"
          aria-label={`${summary} Number at risk: ${atRisk.map((a) => `${a.n} at ${a.month} months`).join(', ')}.`}>
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
          {bandPath && <path data-testid="ci-band" d={bandPath} fill="var(--color-series-1)" fillOpacity="0.15" stroke="none" />}
          {curves.map((c) => (
            <path key={c.label} d={path(c)} fill="none" stroke={c.color} strokeWidth="2.5" strokeLinejoin="round"
              strokeDasharray={c.dash} />
          ))}
          <g fontSize="12">
            <text x={L} y={RISK_TITLE_Y} fill="var(--color-muted)">Number at risk</text>
            {atRisk.map((a) => (
              <text key={`r${a.month}`} x={x(a.month)} y={RISK_Y} textAnchor="middle" fill="var(--color-ink)">{a.n}</text>
            ))}
          </g>
        </svg>
      </div>
      {curves.length > 1 && (
        <ul aria-label="Legend" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {curves.map((c) => (
            <li key={c.label} className="flex items-center gap-2">
              <svg width="24" height="8" aria-hidden="true">
                <line x1="0" x2="24" y1="4" y2="4" stroke={c.color} strokeWidth="2.5" strokeDasharray={c.dash} />
              </svg>
              {c.label}
            </li>
          ))}
        </ul>
      )}
      {bandPath && <p className="text-xs text-muted">Shaded: 95% CI</p>}
    </div>
  );
}

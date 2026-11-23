import { COLORS } from '@/components/odontogram/visuals';

function ImplantMark({ kind }: { kind: 'planned' | 'placed' | 'failed' }) {
  const stroke = kind === 'planned' ? COLORS.planned : kind === 'failed' ? COLORS.failed : COLORS.placed;
  const fill = kind === 'planned' ? 'var(--color-surface)' : kind === 'failed' ? 'var(--color-bad-soft)' : 'var(--color-fixture)';
  return (
    <svg viewBox="0 0 14 40" width={14} height={40} aria-hidden="true">
      <polygon points="2.5,4 11.5,4 11.5,32 9,37 5,37 2.5,32" style={{ fill, stroke }} strokeWidth={1.5}
        strokeDasharray={kind === 'planned' ? '3 2' : undefined} />
      {kind === 'failed' && <path d="M1 14 L13 26 M13 14 L1 26" style={{ stroke: COLORS.failed }} strokeWidth={2.5} />}
    </svg>
  );
}

function BridgeMark({ temporary }: { temporary: boolean }) {
  return (
    <svg viewBox="0 0 40 16" width={40} height={16} aria-hidden="true">
      <rect x={1} y={1} width={38} height={14} rx={6} stroke={COLORS.restored} strokeWidth={2}
        strokeDasharray={temporary ? '5 3' : undefined} style={{ fill: 'var(--color-accent-soft)' }} />
    </svg>
  );
}

const ITEMS = [
  { label: 'Planned implant', mark: <ImplantMark kind="planned" /> },
  { label: 'Placed implant', mark: <ImplantMark kind="placed" /> },
  { label: 'Failed implant', mark: <ImplantMark kind="failed" /> },
  { label: 'Temporary bridge', mark: <BridgeMark temporary /> },
  { label: 'Final bridge', mark: <BridgeMark temporary={false} /> },
];

export function FullArchLegend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink" aria-label="Legend">
      {ITEMS.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          {item.mark}
          <span>{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

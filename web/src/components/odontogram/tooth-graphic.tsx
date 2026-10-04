import type { ToothType } from '@/lib/patients/fdi';
import type { ToothState } from '@/lib/patients/types';
import { toothShape } from './shapes';
import { COLORS, toothVisual, type ToothVisual } from './visuals';

function Fixture({ kind }: { kind: NonNullable<ToothVisual['fixture']> }) {
  const stroke = kind === 'planned' ? COLORS.planned : kind === 'failed' ? COLORS.failed : COLORS.placed;
  return (
    <g data-glyph="fixture">
      <path
        d="M14 84 L14 22 L20 10 L26 22 L26 84 Z"
        style={{ fill: kind === 'planned' ? 'none' : 'var(--color-fixture)', stroke }}
        strokeWidth={1.5}
        strokeDasharray={kind === 'planned' ? '3 2' : undefined}
      />
      {[34, 46, 58, 70].map((y) => (
        <path key={y} d={`M12 ${y} L28 ${y - 4}`} style={{ stroke }} strokeWidth={1} />
      ))}
      {kind === 'failed' && <path d="M4 20 L36 120 M36 20 L4 120" style={{ stroke: COLORS.failed }} strokeWidth={3} />}
    </g>
  );
}

/** One tooth in the upper-jaw frame (40 × 130). Callers flip it for the lower jaw. */
export function ToothGraphic({ type, jaw, status }: { type: ToothType; jaw: 'upper' | 'lower'; status: ToothState }) {
  const visual = toothVisual(status);
  const shape = toothShape(type, jaw);
  return (
    <g>
      {visual.showRoots && <path d={shape.roots} style={{ fill: 'var(--color-surface)', stroke: visual.stroke }} strokeWidth={1.5} />}
      {visual.glyph === 'fixture' && visual.fixture && <Fixture kind={visual.fixture} />}
      <path
        d={shape.crown}
        style={{ fill: visual.crownFill, stroke: visual.stroke }}
        strokeWidth={1.5}
        strokeDasharray={visual.dashed ? '4 3' : undefined}
      />
      {visual.glyph === 'cross' && <path d="M8 86 L32 124 M32 86 L8 124" style={{ stroke: 'var(--color-bad)' }} strokeWidth={3} />}
    </g>
  );
}

'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { STATE_LABELS, type ToothState } from '@/lib/patients/types';
import { CHART_HEIGHT, CHART_WIDTH, MIDLINE_X, TOOTH_H, TOOTH_W, JAW_GAP, toothLayout, type ToothBox } from './layout';
import { ToothGraphic } from './tooth-graphic';

type Props = {
  statuses: Partial<Record<number, ToothState>>;
  selected: readonly number[];
  onSelect: (fdi: number, additive: boolean) => void;
  /** Current component per tooth (CS, HA, TB, MUA, AB, CR). */
  badges?: Partial<Record<number, string>>;
  /** Teeth whose implant has an open complication. */
  alerts?: Partial<Record<number, boolean>>;
};

const BOXES = toothLayout();

function Tooth({
  box,
  status,
  selected,
  onSelect,
  badge,
  alert,
}: {
  box: ToothBox;
  status: ToothState;
  selected: boolean;
  onSelect: Props['onSelect'];
  badge: string | undefined;
  alert: boolean;
}) {
  const transform =
    box.jaw === 'upper' ? `translate(${box.x} ${box.y})` : `translate(${box.x} ${box.y + TOOTH_H}) scale(1 -1)`;
  const numberY = box.jaw === 'upper' ? TOOTH_H + 18 : box.y - 9;
  const additive = (e: MouseEvent | KeyboardEvent) => e.shiftKey || e.ctrlKey || e.metaKey;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Tooth ${box.fdi}, ${STATE_LABELS[status]}${badge ? `, ${badge}` : ''}${alert ? ', open complication' : ''}`}
      aria-pressed={selected}
      data-tooth={box.fdi}
      data-status={status}
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-accent"
      onClick={(e) => onSelect(box.fdi, additive(e))}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(box.fdi, additive(e));
        }
      }}
    >
      <rect
        x={box.x - 3}
        y={box.y - 3}
        width={TOOTH_W + 6}
        height={TOOTH_H + 6}
        rx={6}
        style={{ fill: selected ? 'var(--color-accent-soft)' : 'transparent', stroke: selected ? 'var(--color-accent)' : 'transparent' }}
        strokeWidth={2}
      />
      <g transform={transform}>
        <ToothGraphic type={box.type} jaw={box.jaw} status={status} />
      </g>
      {badge && (
        <g data-badge>
          <rect x={box.x + 4} y={box.y + (box.jaw === 'upper' ? 96 : 20)} width={TOOTH_W - 8} height={16} rx={3} style={{ fill: 'var(--color-accent-strong)' }} />
          <text
            x={box.x + TOOTH_W / 2}
            y={box.y + (box.jaw === 'upper' ? 108 : 32)}
            textAnchor="middle"
            fontSize={10}
            fontWeight={700}
            style={{ fill: 'var(--color-surface)' }}
          >
            {badge}
          </text>
        </g>
      )}
      {alert && (
        <circle data-alert cx={box.x + TOOTH_W - 4} cy={box.y + (box.jaw === 'upper' ? 6 : TOOTH_H - 6)} r={6}
          style={{ fill: 'var(--color-warn)', stroke: 'var(--color-surface)' }} strokeWidth={2} />
      )}
      <text x={box.x + TOOTH_W / 2} y={numberY} textAnchor="middle" fontSize={13} style={{ fill: 'var(--color-muted)' }}>
        {box.fdi}
      </text>
    </g>
  );
}

export function Odontogram({ statuses, selected, onSelect, badges, alerts }: Props) {
  return (
    <svg
      viewBox={`-6 -6 ${CHART_WIDTH + 12} ${CHART_HEIGHT + 12}`}
      className="h-auto w-full max-w-4xl select-none"
      role="group"
      aria-label="Odontogram"
    >
      <line x1={-4} x2={CHART_WIDTH + 4} y1={TOOTH_H + JAW_GAP / 2} y2={TOOTH_H + JAW_GAP / 2} style={{ stroke: 'var(--color-ink)' }} strokeWidth={2.5} />
      <line x1={MIDLINE_X} x2={MIDLINE_X} y1={TOOTH_H - 30} y2={TOOTH_H + JAW_GAP + 30} style={{ stroke: 'var(--color-ink)' }} strokeWidth={2.5} />
      {BOXES.map((box) => (
        <Tooth
          key={box.fdi}
          box={box}
          status={statuses[box.fdi] ?? 'present'}
          selected={selected.includes(box.fdi)}
          badge={badges?.[box.fdi]}
          alert={alerts?.[box.fdi] ?? false}
          onSelect={onSelect}
        />
      ))}
    </svg>
  );
}

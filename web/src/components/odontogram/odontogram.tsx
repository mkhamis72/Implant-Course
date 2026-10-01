'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { STATE_LABELS, type ToothState } from '@/lib/patients/types';
import { CHART_HEIGHT, CHART_WIDTH, MIDLINE_X, TOOTH_H, TOOTH_W, JAW_GAP, toothLayout, type ToothBox } from './layout';
import { ToothGraphic } from './tooth-graphic';

type Props = {
  statuses: Partial<Record<number, ToothState>>;
  selected: readonly number[];
  onSelect: (fdi: number, additive: boolean) => void;
};

const BOXES = toothLayout();

function Tooth({ box, status, selected, onSelect }: { box: ToothBox; status: ToothState; selected: boolean; onSelect: Props['onSelect'] }) {
  const transform =
    box.jaw === 'upper' ? `translate(${box.x} ${box.y})` : `translate(${box.x} ${box.y + TOOTH_H}) scale(1 -1)`;
  const numberY = box.jaw === 'upper' ? TOOTH_H + 18 : box.y - 9;
  const additive = (e: MouseEvent | KeyboardEvent) => e.shiftKey || e.ctrlKey || e.metaKey;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Tooth ${box.fdi}, ${STATE_LABELS[status]}`}
      aria-pressed={selected}
      data-tooth={box.fdi}
      data-status={status}
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-blue-600"
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
        fill={selected ? '#dbeafe' : 'transparent'}
        stroke={selected ? '#2563eb' : 'transparent'}
        strokeWidth={2}
      />
      <g transform={transform}>
        <ToothGraphic type={box.type} jaw={box.jaw} status={status} />
      </g>
      <text x={box.x + TOOTH_W / 2} y={numberY} textAnchor="middle" fontSize={13} fill="#334155">
        {box.fdi}
      </text>
    </g>
  );
}

export function Odontogram({ statuses, selected, onSelect }: Props) {
  return (
    <svg
      viewBox={`-6 -6 ${CHART_WIDTH + 12} ${CHART_HEIGHT + 12}`}
      className="h-auto w-full max-w-4xl select-none"
      role="group"
      aria-label="Odontogram"
    >
      <line x1={-4} x2={CHART_WIDTH + 4} y1={TOOTH_H + JAW_GAP / 2} y2={TOOTH_H + JAW_GAP / 2} stroke="#0f172a" strokeWidth={2.5} />
      <line x1={MIDLINE_X} x2={MIDLINE_X} y1={TOOTH_H - 30} y2={TOOTH_H + JAW_GAP + 30} stroke="#0f172a" strokeWidth={2.5} />
      {BOXES.map((box) => (
        <Tooth
          key={box.fdi}
          box={box}
          status={statuses[box.fdi] ?? 'present'}
          selected={selected.includes(box.fdi)}
          onSelect={onSelect}
        />
      ))}
    </svg>
  );
}

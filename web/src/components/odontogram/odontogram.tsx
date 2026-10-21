'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { STATE_LABELS, type ToothState } from '@/lib/patients/types';
import { CHART_HEIGHT, CHART_WIDTH, MIDLINE_X, SPAN_H, TOOTH_H, TOOTH_W, JAW_GAP, spanBox, toothLayout, type ToothBox } from './layout';
import { ToothGraphic } from './tooth-graphic';

/** A current restoration: one bar under `teeth` (arch order); the first of `implantTeeth` opens for a pontic. */
export type Span = { id: string; teeth: number[]; implantTeeth: number[]; label: string; temporary: boolean };

type Props = {
  statuses: Partial<Record<number, ToothState>>;
  selected: readonly number[];
  /** `tab` asks the tooth panel to open that implant tab (a restoration bar, or a tooth a restoration covers). */
  onSelect: (fdi: number, additive: boolean, tab?: 'restoration') => void;
  /** Current component per tooth (CS, HA, TB, MUA, AB). */
  badges?: Partial<Record<number, string>>;
  /** Teeth whose implant has an open complication. */
  alerts?: Partial<Record<number, boolean>>;
  /** Current restorations, one bar each. */
  spans?: readonly Span[];
};

const BOXES = toothLayout();

const additive = (e: MouseEvent | KeyboardEvent) => e.shiftKey || e.ctrlKey || e.metaKey;

function Tooth({
  box,
  status,
  selected,
  onSelect,
  badge,
  alert,
  span,
}: {
  box: ToothBox;
  status: ToothState;
  selected: boolean;
  onSelect: Props['onSelect'];
  badge: string | undefined;
  alert: boolean;
  span: Span | undefined;
}) {
  const transform =
    box.jaw === 'upper' ? `translate(${box.x} ${box.y})` : `translate(${box.x} ${box.y + TOOTH_H}) scale(1 -1)`;
  const numberY = box.jaw === 'upper' ? TOOTH_H + 18 : box.y - 9;
  // A pontic or cantilever: covered by a restoration but without an implant of its own.
  const pontic = span !== undefined && !span.implantTeeth.includes(box.fdi);
  // A covered tooth opens its restoration (a pontic through the first implant); Shift/Ctrl keeps plain multi-select.
  const select = (e: MouseEvent | KeyboardEvent) => {
    if (span && !additive(e)) onSelect(pontic ? span.implantTeeth[0] : box.fdi, false, 'restoration');
    else onSelect(box.fdi, additive(e));
  };
  const outline = selected ? 'var(--color-accent)' : pontic ? 'var(--color-line-strong)' : 'transparent';

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`Tooth ${box.fdi}, ${STATE_LABELS[status]}${badge ? `, ${badge}` : ''}${alert ? ', open complication' : ''}${pontic ? `, under ${span.label}` : ''}`}
      aria-pressed={selected}
      data-tooth={box.fdi}
      data-status={status}
      data-covered={span ? (pontic ? 'pontic' : 'implant') : undefined}
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-accent"
      onClick={select}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select(e);
        }
      }}
    >
      <rect
        x={box.x - 3}
        y={box.y - 3}
        width={TOOTH_W + 6}
        height={TOOTH_H + 6}
        rx={6}
        style={{ fill: selected ? 'var(--color-accent-soft)' : 'transparent', stroke: outline }}
        strokeWidth={2}
        strokeDasharray={pontic && !selected ? '5 4' : undefined}
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

/** A restoration's bar, in the jaw gap on its jaw's side of the jaw line; temporaries are drawn lighter. */
function SpanBar({ span, onSelect }: { span: Span; onSelect: Props['onSelect'] }) {
  const { x, y, width } = spanBox(span.teeth);
  const open = () => onSelect(span.implantTeeth[0], false, 'restoration');
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={span.temporary ? `${span.label}, temporary` : span.label}
      data-span={span.id}
      opacity={span.temporary ? 0.5 : undefined}
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ink"
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
    >
      <rect x={x + 2} y={y} width={width - 4} height={SPAN_H} rx={SPAN_H / 2} stroke="transparent" strokeWidth={2}
        style={{ fill: 'var(--color-accent)' }} />
      <text x={x + width / 2} y={y + SPAN_H - 3} textAnchor="middle" fontSize={9} fontWeight={600} style={{ fill: 'var(--color-surface)' }}>
        {span.label}
      </text>
    </g>
  );
}

export function Odontogram({ statuses, selected, onSelect, badges, alerts, spans = [] }: Props) {
  const spanOf = new Map(spans.flatMap((s) => s.teeth.map((t) => [t, s] as const)));
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
          span={spanOf.get(box.fdi)}
          onSelect={onSelect}
        />
      ))}
      {spans.map((span) => (
        <SpanBar key={span.id} span={span} onSelect={onSelect} />
      ))}
    </svg>
  );
}

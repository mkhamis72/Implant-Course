'use client';

import type { KeyboardEvent, MouseEvent } from 'react';
import { CHART_WIDTH, MIDLINE_X, TOOTH_W, toothLayout, type ToothBox } from '@/components/odontogram/layout';
import { COLORS } from '@/components/odontogram/visuals';
import { implantLine, type ArchBridge, type ArchImplant } from './model';

type Props = {
  model: { implants: ArchImplant[]; bridges: ArchBridge[] };
  selected: readonly number[];
  /** `tab` asks the tooth panel to open that implant tab (a bridge opens its restoration). */
  onSelect: (fdi: number, additive: boolean, tab?: 'restoration') => void;
};

// Vertical layout, top to bottom: upper implant zone (a zygomatic is 130 long), upper bridge row, upper numbers,
// lower numbers, lower bridge row, lower implant zone.
const HEAD_Y = { upper: 150, lower: 274 } as const;
const BRIDGE_H = 22;
const BRIDGE_Y = { upper: 160, lower: 242 } as const;
const NUMBER_Y = { upper: 200, lower: 232 } as const;
const JAW_LINE_Y = 216;
const HEIGHT = 414;
/** Half the drawn width of an implant body. */
const BODY_R = 4.5;

const BOXES = toothLayout();
const BOX = new Map(BOXES.map((b) => [b.fdi, b]));
const centre = (fdi: number) => (BOX.get(fdi)?.x ?? MIDLINE_X) + TOOTH_W / 2;

const additive = (e: MouseEvent | KeyboardEvent) => e.shiftKey || e.ctrlKey || e.metaKey;

function onKey(run: (e: KeyboardEvent) => void) {
  return (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      run(e);
    }
  };
}

/** One bridge: a connected rounded shape across its teeth; pontic units lighter, a temporary dashed. */
function Bridge({ bridge, onSelect }: { bridge: ArchBridge; onSelect: Props['onSelect'] }) {
  const boxes = bridge.teeth.map((t) => BOX.get(t)).filter((b): b is ToothBox => b !== undefined);
  if (boxes.length === 0) return null;
  const jaw = boxes[0].jaw;
  const x = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x)) + TOOTH_W;
  const y = BRIDGE_Y[jaw];
  const open = () => onSelect(bridge.implantTeeth[0], false, 'restoration');
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={`${bridge.label}, ${bridge.temporary ? 'temporary' : 'final'}`}
      data-bridge={bridge.id}
      data-temporary={bridge.temporary}
      className="cursor-pointer outline-none [&:focus-visible>rect]:stroke-ink"
      onClick={open}
      onKeyDown={onKey(open)}
    >
      <rect x={x} y={y} width={right - x} height={BRIDGE_H} rx={8} stroke={COLORS.restored} strokeWidth={2}
        strokeDasharray={bridge.temporary ? '6 4' : undefined} style={{ fill: 'var(--color-surface)' }} />
      <g>
        {boxes.map((b) => {
          const abutment = bridge.implantTeeth.includes(b.fdi);
          return (
            <rect key={b.fdi} data-unit={abutment ? 'implant' : 'pontic'} x={b.x + 3} y={y + 3} width={TOOTH_W - 6}
              height={BRIDGE_H - 6} rx={3}
              style={{ fill: abutment ? 'var(--color-accent-soft)' : COLORS.faint, stroke: abutment ? COLORS.restored : 'var(--color-line)' }}
              strokeWidth={1} />
          );
        })}
      </g>
      <text x={(x + right) / 2} y={y + BRIDGE_H / 2 + 3.5} textAnchor="middle" fontSize={10} fontWeight={600}
        style={{ fill: 'var(--color-accent-strong)' }}>
        {bridge.label}
      </text>
    </g>
  );
}

/** A small tag beside an implant head: filled for the component badge, outlined for the type label. */
function Tag({ x, y, text, filled }: { x: number; y: number; text: string; filled: boolean }) {
  return (
    <g data-tag={filled ? 'badge' : 'type'}>
      <rect x={x} y={y} width={28} height={14} rx={3} strokeWidth={1.5}
        style={filled
          ? { fill: 'var(--color-accent-strong)' }
          : { fill: 'var(--color-surface)', stroke: 'var(--color-accent-strong)' }} />
      <text x={x + 14} y={y + 10.5} textAnchor="middle" fontSize={9} fontWeight={700}
        style={{ fill: filled ? 'var(--color-surface)' : 'var(--color-accent-strong)' }}>
        {text}
      </text>
    </g>
  );
}

function Implant({ imp, selected, onSelect }: { imp: ArchImplant; selected: boolean; onSelect: Props['onSelect'] }) {
  const head = { x: centre(imp.tooth), y: HEAD_Y[imp.jaw] };
  const line = implantLine(imp, head);
  const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const rotation = (Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI;
  const stroke = imp.planned ? COLORS.planned : imp.failed ? COLORS.failed : COLORS.placed;
  const fill = imp.planned ? 'var(--color-surface)' : imp.failed ? 'var(--color-bad-soft)' : 'var(--color-fixture)';
  // Threads: short slanted strokes across the body, stopping short of the tapered apex.
  const threads: string[] = [];
  for (let t = 6; t < len - 8; t += 6) threads.push(`M${t} ${-BODY_R} L${t + 2.5} ${BODY_R}`);
  // Tags sit beside the head, on the side away from the apex, stacked toward the apex.
  const side = imp.lean === 1 ? -1 : 1;
  const tagX = side === 1 ? head.x + 7 : head.x - 35;
  const step = imp.jaw === 'upper' ? -18 : 18;
  const firstY = imp.jaw === 'upper' ? head.y - 18 : head.y + 4;
  const tags = [
    imp.badge && { text: imp.badge, filled: true },
    imp.label && { text: imp.label, filled: false },
  ].filter((t): t is { text: string; filled: boolean } => Boolean(t));
  const select = (e: MouseEvent | KeyboardEvent) => onSelect(imp.tooth, additive(e));

  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={imp.description}
      aria-pressed={selected}
      data-implant={imp.tooth}
      data-kind={imp.kind}
      data-planned={imp.planned}
      data-failed={imp.failed}
      className="cursor-pointer outline-none [&:focus-visible>line]:stroke-accent"
      onClick={select}
      onKeyDown={onKey(select)}
    >
      {/* Selection halo, and a wider hit area when not selected. */}
      <line {...line} stroke={selected ? 'var(--color-accent-soft)' : 'transparent'} strokeWidth={20} strokeLinecap="round" />
      <g transform={`translate(${head.x} ${head.y}) rotate(${rotation})`}>
        <polygon
          points={`0,${-BODY_R} ${len - 6},${-BODY_R} ${len},-2 ${len},2 ${len - 6},${BODY_R} 0,${BODY_R}`}
          style={{ fill, stroke }}
          strokeWidth={selected ? 2.5 : 1.5}
          strokeDasharray={imp.planned ? '3 2' : undefined}
        />
        {!imp.planned && <path d={threads.join(' ')} style={{ stroke }} strokeWidth={1} />}
        {/* The platform at the head. */}
        <rect x={-3} y={-BODY_R - 1.5} width={3} height={2 * BODY_R + 3} style={{ fill: stroke }} />
        {imp.failed && (
          <path data-cross d={`M${len / 2 - 7} -7 L${len / 2 + 7} 7 M${len / 2 - 7} 7 L${len / 2 + 7} -7`}
            style={{ stroke: COLORS.failed }} strokeWidth={3} />
        )}
      </g>
      {tags.map((t, i) => (
        <Tag key={t.text + i} x={tagX} y={firstY + i * step} text={t.text} filled={t.filled} />
      ))}
    </g>
  );
}

export function FullArch({ model, selected, onSelect }: Props) {
  const bridgeOf = new Map(model.bridges.flatMap((b) => b.teeth.map((t) => [t, b] as const)));
  return (
    <div className="space-y-2">
      <svg
        viewBox={`-6 -6 ${CHART_WIDTH + 12} ${HEIGHT + 12}`}
        className="h-auto w-full max-w-4xl select-none"
        role="group"
        aria-label="Implants and bridges"
      >
        {/* The static drawing (jaw lines, tooth numbers) is the labelled image; the implants and bridges stay buttons. */}
        <g role="img" aria-label="Full-arch chart">
          <line x1={-4} x2={CHART_WIDTH + 4} y1={JAW_LINE_Y} y2={JAW_LINE_Y} style={{ stroke: COLORS.muted }} strokeWidth={1.5} />
          <line x1={MIDLINE_X} x2={MIDLINE_X} y1={HEAD_Y.upper - 20} y2={HEAD_Y.lower + 20} style={{ stroke: COLORS.muted }} strokeWidth={1.5} />
          {BOXES.map((b) => (
            <text key={b.fdi} x={b.x + TOOTH_W / 2} y={NUMBER_Y[b.jaw]} textAnchor="middle" fontSize={13}
              style={{ fill: 'var(--color-muted)' }}>
              {b.fdi}
            </text>
          ))}
        </g>
        {/* Links from each implant head to the bridge unit it carries. */}
        <g aria-hidden="true">
          {model.implants.filter((imp) => bridgeOf.get(imp.tooth)?.implantTeeth.includes(imp.tooth)).map((imp) => (
            <line key={imp.siteId} data-link={imp.tooth} x1={centre(imp.tooth)} x2={centre(imp.tooth)} y1={HEAD_Y[imp.jaw]}
              y2={imp.jaw === 'upper' ? BRIDGE_Y.upper + 3 : BRIDGE_Y.lower + BRIDGE_H - 3}
              style={{ stroke: COLORS.ink }} strokeWidth={2} />
          ))}
        </g>
        {model.bridges.map((b) => (
          <Bridge key={b.id} bridge={b} onSelect={onSelect} />
        ))}
        {model.implants.map((imp) => (
          <Implant key={imp.siteId} imp={imp} selected={selected.includes(imp.tooth)} onSelect={onSelect} />
        ))}
      </svg>
      <p className="text-sm text-muted">Schematic drawing — not a substitute for CBCT or 3D planning.</p>
    </div>
  );
}

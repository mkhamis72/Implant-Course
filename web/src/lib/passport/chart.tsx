// The passport's chart picture: the full-arch drawing (src/components/full-arch/full-arch.tsx) redrawn with react-pdf
// Svg primitives from fullArchModel's output and the same geometry (implantLine, HEAD_Y, toothLayout). No DOM.
import { G, Line, Polygon, Path, Rect, Svg, Text } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { CHART_WIDTH, MIDLINE_X, TOOTH_W, toothLayout, type ToothBox } from '@/components/odontogram/layout';
import { ARCH_VIEWBOX, archCentre, BODY_R, HEAD_Y, implantLine, type ArchBridge, type ArchImplant } from '@/components/full-arch/model';
import type { FullArchDrawing } from './model';
import { PASSPORT_FONT } from './fonts';

// The web chart's vertical layout (full-arch.tsx): bridge rows, tooth numbers and the jaw line between the implant zones.
const BRIDGE_H = 22;
const BRIDGE_Y = { upper: 160, lower: 242 } as const;
const NUMBER_Y = { upper: 200, lower: 232 } as const;
const JAW_LINE_Y = 216;

// The app's colour tokens (globals.css), as printed colours: PDFs have no CSS variables.
export const CHART_COLORS = {
  tooth: '#3d4f55', line: '#828f8b', lineLight: '#d9e2df', muted: '#55666b', faint: '#eef3f1', surface: '#ffffff',
  planned: '#b86b0a', placed: '#1d6b3a', fixture: '#cfe7d6', failed: '#b42318', failedSoft: '#fdeceb',
  accent: '#0f766e', accentStrong: '#115e59', accentSoft: '#e3f3f0',
} as const;
const C = CHART_COLORS;

const BOXES = toothLayout();
const BOX = new Map(BOXES.map((b) => [b.fdi, b]));

// Svg text takes the font from its style; the typings list only presentation attributes.
const font = (size: number, bold = false) => ({ fontFamily: PASSPORT_FONT, fontSize: size, fontWeight: bold ? 700 : 400 }) as object;

function Bridge({ bridge }: { bridge: ArchBridge }) {
  const boxes = bridge.teeth.map((t) => BOX.get(t)).filter((b): b is ToothBox => b !== undefined);
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x)) + TOOTH_W;
  const y = BRIDGE_Y[boxes[0].jaw];
  const labelW = Math.min(right - x - 8, bridge.label.length * 5.6 + 10);
  return (
    <G>
      <Rect x={x} y={y} width={right - x} height={BRIDGE_H} rx={8} ry={8} fill={C.surface} stroke={C.accent} strokeWidth={2}
        strokeDasharray={bridge.temporary ? '6 4' : undefined} />
      {boxes.map((b) => {
        const abutment = bridge.implantTeeth.includes(b.fdi);
        return (
          <Rect key={b.fdi} x={b.x + 3} y={y + 3} width={TOOTH_W - 6} height={BRIDGE_H - 6} rx={3} ry={3}
            fill={abutment ? C.accentSoft : C.faint} stroke={abutment ? C.accent : C.lineLight} strokeWidth={1} />
        );
      })}
      {/* A white plate behind the label keeps it readable across the unit boxes (the web chart uses a halo). */}
      <Rect x={(x + right) / 2 - labelW / 2} y={y + 5} width={labelW} height={BRIDGE_H - 10} rx={2} ry={2} fill={C.surface} />
      <Text x={(x + right) / 2} y={y + BRIDGE_H / 2 + 3.5} textAnchor="middle" fill={C.accentStrong} style={font(10, true)}>
        {bridge.label}
      </Text>
    </G>
  );
}

function Tag({ x, y, text, filled }: { x: number; y: number; text: string; filled: boolean }) {
  return (
    <G>
      <Rect x={x} y={y} width={28} height={14} rx={3} ry={3} strokeWidth={1.5}
        fill={filled ? C.accentStrong : C.surface} stroke={C.accentStrong} />
      <Text x={x + 14} y={y + 10.5} textAnchor="middle" fill={filled ? C.surface : C.accentStrong} style={font(9, true)}>
        {text}
      </Text>
    </G>
  );
}

function Implant({ imp }: { imp: ArchImplant }) {
  const head = { x: archCentre(imp.tooth), y: HEAD_Y[imp.jaw] };
  const line = implantLine(imp, head);
  const len = Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
  const rotation = (Math.atan2(line.y2 - line.y1, line.x2 - line.x1) * 180) / Math.PI;
  const stroke = imp.planned ? C.planned : imp.failed ? C.failed : C.placed;
  const fill = imp.planned ? C.surface : imp.failed ? C.failedSoft : C.fixture;
  const threads: string[] = [];
  for (let t = 6; t < len - 8; t += 6) threads.push(`M${t} ${-BODY_R} L${t + 2.5} ${BODY_R}`);
  const side = imp.lean === 1 ? -1 : 1;
  const tagX = side === 1 ? head.x + 7 : head.x - 35;
  const step = imp.jaw === 'upper' ? -18 : 18;
  const firstY = imp.jaw === 'upper' ? head.y - 18 : head.y + 4;
  const tags = [
    imp.badge && { text: imp.badge, filled: true },
    imp.label && { text: imp.label, filled: false },
  ].filter((t): t is { text: string; filled: boolean } => Boolean(t));
  return (
    <G>
      <G transform={`translate(${head.x} ${head.y}) rotate(${rotation})`}>
        <Polygon points={`0,${-BODY_R} ${len - 6},${-BODY_R} ${len},-2 ${len},2 ${len - 6},${BODY_R} 0,${BODY_R}`}
          fill={fill} stroke={stroke} strokeWidth={1.5} strokeDasharray={imp.planned ? '3 2' : undefined} />
        {!imp.planned && threads.length > 0 && <Path d={threads.join(' ')} stroke={stroke} strokeWidth={1} />}
        <Rect x={-3} y={-BODY_R - 1.5} width={3} height={2 * BODY_R + 3} fill={stroke} />
        {imp.failed && (
          <Path d={`M${len / 2 - 7} -7 L${len / 2 + 7} 7 M${len / 2 - 7} 7 L${len / 2 + 7} -7`} stroke={C.failed} strokeWidth={3} />
        )}
      </G>
      {tags.map((t, i) => <Tag key={t.text + i} x={tagX} y={firstY + i * step} text={t.text} filled={t.filled} />)}
    </G>
  );
}

/** Tags stacked beside an implant head (badge, type label), as Implant draws them. */
const tagCount = (imp: ArchImplant) => (imp.badge ? 1 : 0) + (imp.label ? 1 : 0);

/**
 * The viewBox: the web chart's, cut down to what is drawn. Each arch's implant zone ends just past its furthest apex
 * or tag (the web keeps room for a zygomatic everywhere); an arch with nothing drawn loses its zone, as on the web.
 */
export function chartView(drawing: FullArchDrawing): { x: number; y: number; width: number; height: number } {
  const PAD = 8;
  const upper = drawing.implants.filter((i) => i.jaw === 'upper');
  const lower = drawing.implants.filter((i) => i.jaw === 'lower');
  let top = HEAD_Y.upper - 24;
  for (const imp of upper) {
    const line = implantLine(imp, { x: archCentre(imp.tooth), y: HEAD_Y.upper });
    const tags = tagCount(imp) ? HEAD_Y.upper - 18 - 18 * (tagCount(imp) - 1) : HEAD_Y.upper;
    top = Math.min(top, line.y2 - BODY_R - PAD, tags - PAD);
  }
  let bottom = HEAD_Y.lower + 24;
  for (const imp of lower) {
    const line = implantLine(imp, { x: archCentre(imp.tooth), y: HEAD_Y.lower });
    const tags = tagCount(imp) ? HEAD_Y.lower + 4 + 18 * (tagCount(imp) - 1) + 14 : HEAD_Y.lower;
    bottom = Math.max(bottom, line.y2 + BODY_R + PAD, tags + PAD);
  }
  top = Math.max(top, ARCH_VIEWBOX.y);
  bottom = Math.min(bottom, ARCH_VIEWBOX.y + ARCH_VIEWBOX.height);
  return { x: ARCH_VIEWBOX.x, y: top, width: ARCH_VIEWBOX.width, height: bottom - top };
}

/** The full-arch drawing at `width` points wide (height follows the drawing). */
export function PassportChart({ drawing, width }: { drawing: FullArchDrawing; width: number }): ReactNode {
  const view = chartView(drawing);
  const height = (width * view.height) / view.width;
  const bridgeOf = new Map(drawing.bridges.flatMap((b) => b.teeth.map((t) => [t, b] as const)));
  return (
    <Svg width={width} height={height} viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`}>
      <Line x1={-4} x2={CHART_WIDTH + 4} y1={JAW_LINE_Y} y2={JAW_LINE_Y} stroke={C.line} strokeWidth={1.5} />
      <Line x1={MIDLINE_X} x2={MIDLINE_X} y1={HEAD_Y.upper - 20} y2={HEAD_Y.lower + 20} stroke={C.line} strokeWidth={1.5} />
      {BOXES.map((b) => (
        <Text key={b.fdi} x={b.x + TOOTH_W / 2} y={NUMBER_Y[b.jaw]} textAnchor="middle" fill={C.muted} style={font(13)}>
          {String(b.fdi)}
        </Text>
      ))}
      {drawing.implants.filter((imp) => bridgeOf.get(imp.tooth)?.implantTeeth.includes(imp.tooth)).map((imp) => (
        <Line key={`link-${imp.siteId}`} x1={archCentre(imp.tooth)} x2={archCentre(imp.tooth)} y1={HEAD_Y[imp.jaw]}
          y2={imp.jaw === 'upper' ? BRIDGE_Y.upper + 3 : BRIDGE_Y.lower + BRIDGE_H - 3} stroke={C.tooth} strokeWidth={2} />
      ))}
      {drawing.bridges.map((b) => <Bridge key={b.id} bridge={b} />)}
      {drawing.implants.map((imp) => <Implant key={imp.siteId} imp={imp} />)}
    </Svg>
  );
}

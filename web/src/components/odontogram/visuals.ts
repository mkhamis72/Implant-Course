import type { ToothState } from '@/lib/patients/types';

export type ToothVisual = {
  crownFill: string;
  stroke: string;
  dashed: boolean;
  showRoots: boolean;
  glyph: 'none' | 'cross' | 'fixture';
  fixture?: 'planned' | 'placed' | 'failed';
};

export const COLORS = {
  ink: 'var(--color-tooth)',
  muted: 'var(--color-line-strong)',
  faint: 'var(--color-tooth-faint)',
  planned: 'var(--color-planned)',
  restored: 'var(--color-accent)',
  placed: 'var(--color-ok)',
  failed: 'var(--color-bad)',
} as const;

export function toothVisual(status: ToothState): ToothVisual {
  switch (status) {
    case 'present':
      return { crownFill: 'var(--color-surface)', stroke: COLORS.ink, dashed: false, showRoots: true, glyph: 'none' };
    case 'missing':
      return { crownFill: COLORS.faint, stroke: COLORS.muted, dashed: true, showRoots: false, glyph: 'none' };
    case 'extracted':
      return { crownFill: COLORS.faint, stroke: COLORS.muted, dashed: true, showRoots: false, glyph: 'cross' };
    case 'implant_planned':
      return { crownFill: 'var(--color-surface)', stroke: COLORS.planned, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'planned' };
    case 'implant_placed':
      return { crownFill: COLORS.faint, stroke: COLORS.muted, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'placed' };
    case 'restored':
      return { crownFill: 'var(--color-accent-soft)', stroke: COLORS.restored, dashed: false, showRoots: false, glyph: 'fixture', fixture: 'placed' };
    case 'failed':
      return { crownFill: 'var(--color-bad-soft)', stroke: COLORS.failed, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'failed' };
  }
}

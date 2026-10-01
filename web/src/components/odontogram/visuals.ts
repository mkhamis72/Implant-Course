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
  ink: '#334155',
  muted: '#94a3b8',
  faint: '#f1f5f9',
  planned: '#2563eb',
  restored: '#0369a1',
  failed: '#dc2626',
} as const;

export function toothVisual(status: ToothState): ToothVisual {
  switch (status) {
    case 'present':
      return { crownFill: '#ffffff', stroke: COLORS.ink, dashed: false, showRoots: true, glyph: 'none' };
    case 'missing':
      return { crownFill: COLORS.faint, stroke: COLORS.muted, dashed: true, showRoots: false, glyph: 'none' };
    case 'extracted':
      return { crownFill: COLORS.faint, stroke: COLORS.muted, dashed: true, showRoots: false, glyph: 'cross' };
    case 'implant_planned':
      return { crownFill: '#ffffff', stroke: COLORS.planned, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'planned' };
    case 'implant_placed':
      return { crownFill: COLORS.faint, stroke: COLORS.muted, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'placed' };
    case 'restored':
      return { crownFill: '#e0f2fe', stroke: COLORS.restored, dashed: false, showRoots: false, glyph: 'fixture', fixture: 'placed' };
    case 'failed':
      return { crownFill: '#fef2f2', stroke: COLORS.failed, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'failed' };
  }
}

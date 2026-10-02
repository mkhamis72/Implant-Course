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
  ink: '#3d4f55',
  muted: '#9aa9ad',
  faint: '#eef3f1',
  planned: '#b86b0a', // warn
  restored: '#0f766e', // accent
  placed: '#1d6b3a', // ok
  failed: '#b42318', // bad
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
      return { crownFill: '#e3f3f0', stroke: COLORS.restored, dashed: false, showRoots: false, glyph: 'fixture', fixture: 'placed' };
    case 'failed':
      return { crownFill: '#fdeceb', stroke: COLORS.failed, dashed: true, showRoots: false, glyph: 'fixture', fixture: 'failed' };
  }
}

import type { SiteState } from '@/lib/inventory/types';
import type { ToothState } from './types';

const SIDE: Record<number, string> = { 1: 'Upper right', 2: 'Upper left', 3: 'Lower left', 4: 'Lower right' };
const POSITION: Record<number, string> = {
  1: 'central incisor', 2: 'lateral incisor', 3: 'canine', 4: 'first premolar',
  5: 'second premolar', 6: 'first molar', 7: 'second molar', 8: 'third molar',
};

/** FDI number to its clinical name, e.g. 36 → "Lower left first molar". */
export function toothName(fdi: number): string {
  return `${SIDE[Math.floor(fdi / 10)]} ${POSITION[fdi % 10]}`;
}

export type PanelAction = 'plan' | 'place' | 'component' | 'followup' | 'cancel';

/** The one obvious next step for a tooth, plus the quieter alternatives. */
export function nextActions(a: { canStart: boolean; siteState: SiteState | null }): { primary: PanelAction | null; secondary: PanelAction[] } {
  if (a.siteState === 'planned') return { primary: 'place', secondary: ['cancel'] };
  if (a.siteState === 'placed') return { primary: 'component', secondary: ['followup'] };
  if (a.siteState === 'restored') return { primary: 'followup', secondary: ['component'] };
  if (!a.siteState && a.canStart) return { primary: 'plan', secondary: ['place'] };
  return { primary: null, secondary: [] };
}

export type Tone = 'ok' | 'warn' | 'bad' | 'accent' | 'off';

/** Tooth status in the app's status colours. */
export function statusTone(state: ToothState): Tone {
  switch (state) {
    case 'implant_planned': return 'warn';
    case 'implant_placed': return 'ok';
    case 'restored': return 'accent';
    case 'failed': return 'bad';
    default: return 'off';
  }
}

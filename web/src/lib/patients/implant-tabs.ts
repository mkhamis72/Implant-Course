/** Tabs of a placed implant in the tooth panel (patients/[id]/implant-tabs.tsx). */
export type ImplantTabKey = 'implant' | 'surgery' | 'visits' | 'complications' | 'corrections';

export type TabBadge = { text: string; srText: string; tone: 'ok' | 'warn' | 'bad' | 'off' };
export type ImplantTab = { key: ImplantTabKey; label: string; badge: TabBadge | null };

export function implantTabs(input: {
  editable: boolean;
  surgery: { recorded: number; total: number };
  complications: { total: number; open: number };
}): ImplantTab[] {
  const { recorded, total } = input.surgery;
  const c = input.complications;
  const tabs: ImplantTab[] = [
    { key: 'implant', label: 'Implant', badge: null },
    {
      key: 'surgery',
      label: 'Surgical details',
      badge: { text: `${recorded}/${total}`, srText: `${recorded} of ${total} recorded`, tone: recorded === total ? 'ok' : 'warn' },
    },
    { key: 'visits', label: 'Visits', badge: null },
    {
      key: 'complications',
      label: 'Complications',
      badge: c.total === 0 ? null : {
        text: String(c.total),
        srText: `${c.total}, ${c.open ? `${c.open} open` : 'none open'}`,
        tone: c.open ? 'bad' : 'off',
      },
    },
  ];
  if (input.editable) tabs.push({ key: 'corrections', label: 'Corrections', badge: null });
  return tabs;
}

/** Right after placement the surgical details are what's missing; otherwise start with the implant. */
export function initialTab(justPlaced: boolean): ImplantTabKey {
  return justPlaced ? 'surgery' : 'implant';
}

/** Keyboard navigation of a tab list (WAI-ARIA tabs pattern): arrows wrap round, Home and End jump. */
export function tabAfterKey<K extends string>(key: string, current: K, order: readonly K[]): K | null {
  const i = order.indexOf(current);
  if (key === 'ArrowRight') return order[(i + 1) % order.length];
  if (key === 'ArrowLeft') return order[(i - 1 + order.length) % order.length];
  if (key === 'Home') return order[0];
  if (key === 'End') return order[order.length - 1];
  return null;
}

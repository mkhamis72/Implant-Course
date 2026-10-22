import { describe, it, expect } from 'vitest';
import { implantTabs, initialTab, tabAfterKey, type ImplantTab } from './implant-tabs';

const keys = (tabs: ImplantTab[]) => tabs.map((t) => t.key);

const none = { restoration: null, xrays: 0 };

describe('implantTabs', () => {
  it('counts the X-rays showing the tooth on X-rays, after Visits', () => {
    const tab = (n: number) => implantTabs({ editable: false, surgery: { recorded: 0, total: 9 }, complications: { total: 0, open: 0 }, restoration: null, xrays: n }).find((t) => t.key === 'xrays')!;
    expect(tab(0)).toEqual({ key: 'xrays', label: 'X-rays', badge: null });
    expect(tab(2).badge).toEqual({ text: '2', srText: '2 X-rays', tone: 'off' });
    expect(tab(1).badge?.srText).toBe('1 X-ray');
  });

  it('lists Implant, Surgical details, Restoration, Visits, Complications and, for editors, Corrections', () => {
    const tabs = implantTabs({ editable: true, surgery: { recorded: 3, total: 9 }, complications: { total: 0, open: 0 }, ...none });
    expect(keys(tabs)).toEqual(['implant', 'surgery', 'restoration', 'visits', 'xrays', 'complications', 'corrections']);
    expect(keys(implantTabs({ editable: false, surgery: { recorded: 3, total: 9 }, complications: { total: 0, open: 0 }, ...none })))
      .toEqual(['implant', 'surgery', 'restoration', 'visits', 'xrays', 'complications']);
  });

  it('counts surgical details recorded: warn until complete', () => {
    const [, partial] = implantTabs({ editable: false, surgery: { recorded: 3, total: 9 }, complications: { total: 0, open: 0 }, ...none });
    expect(partial.badge).toEqual({ text: '3/9', srText: '3 of 9 recorded', tone: 'warn' });
    const [, full] = implantTabs({ editable: false, surgery: { recorded: 9, total: 9 }, complications: { total: 0, open: 0 }, ...none });
    expect(full.badge).toEqual({ text: '9/9', srText: '9 of 9 recorded', tone: 'ok' });
  });

  it("shows the current restoration's stage on Restoration", () => {
    const restoration = (stage: 'temporary' | 'final' | null) =>
      implantTabs({ editable: false, surgery: { recorded: 0, total: 9 }, complications: { total: 0, open: 0 }, restoration: stage, xrays: 0 })[2];
    expect(restoration(null)).toEqual({ key: 'restoration', label: 'Restoration', badge: null });
    expect(restoration('final').badge).toEqual({ text: 'Final', srText: 'current: final', tone: 'ok' });
    expect(restoration('temporary').badge).toEqual({ text: 'Temporary', srText: 'current: temporary', tone: 'off' });
  });

  it('counts complications: none shows no badge, open ones are bad, resolved ones are quiet', () => {
    const complications = (total: number, open: number) =>
      implantTabs({ editable: false, surgery: { recorded: 0, total: 9 }, complications: { total, open }, ...none })[5].badge;
    expect(complications(0, 0)).toBeNull();
    expect(complications(2, 1)).toEqual({ text: '2', srText: '2, 1 open', tone: 'bad' });
    expect(complications(2, 0)).toEqual({ text: '2', srText: '2, none open', tone: 'off' });
  });
});

describe('initialTab', () => {
  it('opens Surgical details right after placement, otherwise Implant', () => {
    expect(initialTab(true)).toBe('surgery');
    expect(initialTab(false)).toBe('implant');
  });
});

describe('tabAfterKey', () => {
  const order = ['implant', 'surgery', 'visits'] as const;
  it('moves with the arrow keys, wrapping round, and jumps with Home and End', () => {
    expect(tabAfterKey('ArrowRight', 'implant', order)).toBe('surgery');
    expect(tabAfterKey('ArrowRight', 'visits', order)).toBe('implant');
    expect(tabAfterKey('ArrowLeft', 'implant', order)).toBe('visits');
    expect(tabAfterKey('Home', 'visits', order)).toBe('implant');
    expect(tabAfterKey('End', 'implant', order)).toBe('visits');
  });
  it('ignores other keys', () => {
    expect(tabAfterKey('Enter', 'surgery', order)).toBeNull();
  });
});

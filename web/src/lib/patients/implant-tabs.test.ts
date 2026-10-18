import { describe, it, expect } from 'vitest';
import { implantTabs, initialTab, tabAfterKey, type ImplantTab } from './implant-tabs';

const keys = (tabs: ImplantTab[]) => tabs.map((t) => t.key);

describe('implantTabs', () => {
  it('lists Implant, Surgical details, Visits, Complications and, for editors, Corrections', () => {
    const tabs = implantTabs({ editable: true, surgery: { recorded: 3, total: 9 }, complications: { total: 0, open: 0 } });
    expect(keys(tabs)).toEqual(['implant', 'surgery', 'visits', 'complications', 'corrections']);
    expect(keys(implantTabs({ editable: false, surgery: { recorded: 3, total: 9 }, complications: { total: 0, open: 0 } })))
      .toEqual(['implant', 'surgery', 'visits', 'complications']);
  });

  it('counts surgical details recorded: warn until complete', () => {
    const [, partial] = implantTabs({ editable: false, surgery: { recorded: 3, total: 9 }, complications: { total: 0, open: 0 } });
    expect(partial.badge).toEqual({ text: '3/9', srText: '3 of 9 recorded', tone: 'warn' });
    const [, full] = implantTabs({ editable: false, surgery: { recorded: 9, total: 9 }, complications: { total: 0, open: 0 } });
    expect(full.badge).toEqual({ text: '9/9', srText: '9 of 9 recorded', tone: 'ok' });
  });

  it('counts complications: none shows no badge, open ones are bad, resolved ones are quiet', () => {
    const complications = (total: number, open: number) =>
      implantTabs({ editable: false, surgery: { recorded: 0, total: 9 }, complications: { total, open } })[3].badge;
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

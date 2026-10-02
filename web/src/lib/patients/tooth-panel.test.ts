import { describe, it, expect } from 'vitest';
import { nextActions, statusTone, toothName } from './tooth-panel';

describe('toothName', () => {
  it('names FDI teeth by jaw, side and position', () => {
    expect(toothName(36)).toBe('Lower left first molar');
    expect(toothName(11)).toBe('Upper right central incisor');
    expect(toothName(23)).toBe('Upper left canine');
    expect(toothName(45)).toBe('Lower right second premolar');
    expect(toothName(48)).toBe('Lower right third molar');
  });
});

describe('nextActions', () => {
  it('offers planning first for a tooth without an implant', () => {
    expect(nextActions({ canStart: true, siteState: null })).toEqual({ primary: 'plan', secondary: ['place'] });
  });
  it('offers placing first for a planned implant', () => {
    expect(nextActions({ canStart: false, siteState: 'planned' })).toEqual({ primary: 'place', secondary: ['cancel'] });
  });
  it('offers a component first for a placed implant, a follow-up first once restored', () => {
    expect(nextActions({ canStart: false, siteState: 'placed' })).toEqual({ primary: 'component', secondary: ['followup'] });
    expect(nextActions({ canStart: false, siteState: 'restored' })).toEqual({ primary: 'followup', secondary: ['component'] });
  });
  it('offers nothing when the tooth has implant records but no active implant', () => {
    expect(nextActions({ canStart: false, siteState: null })).toEqual({ primary: null, secondary: [] });
  });
});

describe('statusTone', () => {
  it('uses the app status colours: planned amber, placed green, restored teal, failed red', () => {
    expect(statusTone('implant_planned')).toBe('warn');
    expect(statusTone('implant_placed')).toBe('ok');
    expect(statusTone('restored')).toBe('accent');
    expect(statusTone('failed')).toBe('bad');
    expect(statusTone('missing')).toBe('off');
  });
});

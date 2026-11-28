import { describe, expect, it } from 'vitest';
import { idParam, parseNot, supervisorChoices } from './list-filters';

describe('idParam', () => {
  it('keeps an id and drops anything else (a bad link must not break the search)', () => {
    expect(idParam('0b8f2a52-6a43-4d3e-9b1e-1c2d3e4f5a6b')).toBe('0b8f2a52-6a43-4d3e-9b1e-1c2d3e4f5a6b');
    expect(idParam('0B8F2A52-6A43-4D3E-9B1E-1C2D3E4F5A6B')).toBe('0b8f2a52-6a43-4d3e-9b1e-1c2d3e4f5a6b');
    expect(idParam('')).toBe('');
    expect(idParam('abc')).toBe('');
    expect(idParam("x' or 1=1")).toBe('');
  });
});

describe('supervisorChoices', () => {
  it('lists active supervisors first, then inactive ones marked as such, each group by name', () => {
    const choices = supervisorChoices([
      { id: '1', full_name: 'Zed', active: true },
      { id: '2', full_name: 'Amr', active: false },
      { id: '3', full_name: 'Bassem', active: true },
    ]);
    expect(choices).toEqual([
      { id: '3', label: 'Bassem' },
      { id: '1', label: 'Zed' },
      { id: '2', label: 'Amr (inactive)' },
    ]);
  });
});

describe('parseNot', () => {
  it('is true only for 1, taking the first of a repeated value', () => {
    expect(parseNot('1')).toBe(true);
    expect(parseNot(undefined)).toBe(false);
    expect(parseNot('0')).toBe(false);
    expect(parseNot('yes')).toBe(false);
    expect(parseNot(['1', '0'])).toBe(true);
    expect(parseNot(['0', '1'])).toBe(false);
  });
});

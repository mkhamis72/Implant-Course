import { describe, it, expect } from 'vitest';
import { parseChecklistText } from './parse';

describe('parseChecklistText', () => {
  it('turns each non-blank line into an item', () => {
    expect(parseChecklistText('Consent signed\r\n\r\n  CBCT reviewed  \n\tKits sterilised\n')).toEqual([
      'Consent signed', 'CBCT reviewed', 'Kits sterilised',
    ]);
  });
  it('strips bullets, numbering and task boxes', () => {
    expect(
      parseChecklistText('- One\n* Two\n• Three\n– Four\n1. Five\n2) Six\n[ ] Seven\n[x] Eight\n- [ ] Nine\n  - [X] Ten'),
    ).toEqual(['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']);
  });
  it('keeps hyphens and numbers inside the text', () => {
    expect(parseChecklistText('3-month review\n10 implants counted\nX-ray taken')).toEqual([
      '3-month review', '10 implants counted', 'X-ray taken',
    ]);
  });
  it('drops lines that were only a bullet', () => {
    expect(parseChecklistText('-\n* \n[ ]\nReal')).toEqual(['Real']);
  });
});

describe('parseChecklistText edge cases', () => {
  it('drops lines that are only a number marker', () => {
    expect(parseChecklistText('1.\nSterile gloves\n2)')).toEqual(['Sterile gloves']);
  });
  it('ignores zero-width characters and splits on old Mac line breaks', () => {
    expect(parseChecklistText('​\nGowns​\rMasks﻿')).toEqual(['Gowns', 'Masks']);
  });
});

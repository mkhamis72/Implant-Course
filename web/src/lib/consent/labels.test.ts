import { describe, it, expect } from 'vitest';
import { CONSENT_ITEMS, consentItems } from './labels';

describe('consentItems', () => {
  it('a course organizer keeps the four course labels', () => {
    expect(consentItems(true)).toEqual(CONSENT_ITEMS);
  });

  it('a clinic gets the four clinic labels, same keys and order', () => {
    const items = consentItems(false);
    expect(items.map((i) => i.key)).toEqual(['treatment', 'research', 'teaching_images', 'follow_up']);
    expect(items.map((i) => i.label)).toEqual([
      "Treatment by the clinic's dentists",
      'Research use of anonymised data',
      'Photos and X-rays for the clinical record and for publication (no face or name)',
      'Follow-up visits and phone contact',
    ]);
    for (const i of items) expect(`${i.short} ${i.label}`).not.toMatch(/course|delegate|teaching/i);
  });
});

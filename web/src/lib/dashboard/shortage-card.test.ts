import { describe, expect, it } from 'vitest';
import { showShortageCard } from './shortage-card';

describe('showShortageCard', () => {
  it('shows to a Schedule viewer when the plan has Inventory, whatever their Inventory permission', () => {
    expect(showShortageCard(true, ['inventory'])).toBe(true);
  });
  it('hides when the plan has no Inventory', () => {
    expect(showShortageCard(true, [])).toBe(false);
  });
  it('hides without Schedule view', () => {
    expect(showShortageCard(false, ['inventory'])).toBe(false);
  });
});

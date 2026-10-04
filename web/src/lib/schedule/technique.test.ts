import { describe, it, expect } from 'vitest';
import { bookingTechnique } from './technique';

const imp = (technique: 'guided' | 'free_hand' | null) => ({ site: { technique } });

describe('bookingTechnique', () => {
  it('is null when no implant has a technique', () => {
    expect(bookingTechnique([])).toBeNull();
    expect(bookingTechnique([imp(null), { site: null }])).toBeNull();
  });
  it('is the shared technique, ignoring unknowns', () => {
    expect(bookingTechnique([imp('guided'), imp(null), imp('guided')])).toBe('guided');
    expect(bookingTechnique([imp('free_hand')])).toBe('free_hand');
  });
  it('is mixed when implants differ', () => {
    expect(bookingTechnique([imp('guided'), imp('free_hand')])).toBe('mixed');
  });
});

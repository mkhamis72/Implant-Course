import { describe, it, expect } from 'vitest';
import { canSetByHand } from './types';

describe('canSetByHand', () => {
  it('allows manual states and failed implants, not active implant states', () => {
    expect(['present', 'missing', 'extracted', 'failed'].every(canSetByHand)).toBe(true);
    expect(['implant_planned', 'implant_placed', 'restored'].some(canSetByHand)).toBe(false);
  });
});

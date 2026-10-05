import { describe, it, expect } from 'vitest';
import { isTalkKind, talkKindOf, TALK_KINDS } from './talks';

describe('talk kinds', () => {
  it('maps route segments to session types and back', () => {
    expect(TALK_KINDS.lectures.type).toBe('lecture');
    expect(TALK_KINDS.workshops.type).toBe('workshop');
    expect(talkKindOf('lecture')).toBe('lectures');
    expect(talkKindOf('workshop')).toBe('workshops');
    expect(talkKindOf('surgery')).toBeNull();
  });
  it('accepts only known kinds', () => {
    expect(isTalkKind('lectures')).toBe(true);
    expect(isTalkKind('workshops')).toBe(true);
    expect(isTalkKind('surgery')).toBe(false);
    expect(isTalkKind(null)).toBe(false);
  });
});

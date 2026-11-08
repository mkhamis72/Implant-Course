import { describe, expect, it } from 'vitest';
import { dayButtons, openSessionId, talkTimeline } from './timeline';

// Cairo is UTC+2 in November: 07:30Z = 09:30 Cairo.
const talk = (id: string, from: string, to: string) => ({ id, starts_at: `2026-11-04T${from}:00Z`, ends_at: `2026-11-04T${to}:00Z` });

describe('talkTimeline', () => {
  it('puts a break between talks 10 minutes or more apart, and none between back-to-back talks', () => {
    const items = talkTimeline([talk('a', '07:30', '08:00'), talk('b', '08:00', '08:30'), talk('c', '09:00', '09:30')]);
    expect(items.map((i) => (i.kind === 'talk' ? i.talk.id : `break ${i.from}–${i.to}`))).toEqual(['a', 'b', 'break 10:30–11:00', 'c']);
  });

  it('ignores a gap under 10 minutes, and has no break around a single talk', () => {
    expect(talkTimeline([talk('a', '07:30', '08:00'), talk('b', '08:05', '08:30')]).map((i) => i.kind)).toEqual(['talk', 'talk']);
    expect(talkTimeline([talk('a', '07:30', '08:00')]).map((i) => i.kind)).toEqual(['talk']);
    expect(talkTimeline([])).toEqual([]);
  });

  it('orders talks by start time whatever order they come in', () => {
    const items = talkTimeline([talk('late', '09:00', '09:30'), talk('early', '07:30', '08:00')]);
    expect(items[0]).toMatchObject({ kind: 'talk', talk: { id: 'early' } });
    expect(items[1]).toMatchObject({ kind: 'break', from: '10:00', to: '11:00' });
  });
});

describe('dayButtons', () => {
  it('lists the days that have sessions plus the selected one, once each, in order, with short labels', () => {
    const days = dayButtons('2026-11-05', ['2026-11-06', '2026-11-04', '2026-11-06']);
    expect(days.map((d) => d.date)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06']);
    expect(days[0]).toEqual({ date: '2026-11-04', weekday: 'Wed', day: '4', selected: false });
    expect(days[1].selected).toBe(true);
  });
});

describe('openSessionId', () => {
  const sessions = [
    { id: 'morning', date: '2026-11-04', start_time: '09:00:00', end_time: '12:00:00' },
    { id: 'afternoon', date: '2026-11-04', start_time: '13:00:00', end_time: '16:00:00' },
  ];
  it('opens the session running now, else the next one today, else the first', () => {
    expect(openSessionId(sessions, '2026-11-04', '13:30')).toBe('afternoon');
    expect(openSessionId(sessions, '2026-11-04', '12:30')).toBe('afternoon');
    expect(openSessionId(sessions, '2026-11-04', '17:00')).toBe('morning');
    expect(openSessionId(sessions, '2026-11-05', '10:00')).toBe('morning');
    expect(openSessionId([], '2026-11-04', '10:00')).toBeNull();
  });
});

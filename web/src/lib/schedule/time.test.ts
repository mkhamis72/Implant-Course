import { describe, it, expect } from 'vitest';
import { GRID_END, GRID_START, SLOT_MINUTES, gridPlacement, minutesOfDay, timeLabels } from './time';

describe('schedule grid', () => {
  it('converts clock times', () => {
    expect(minutesOfDay('07:00')).toBe(420);
    expect(minutesOfDay('13:45')).toBe(825);
  });
  it('places bookings on 15-minute rows (row 1 = 07:00)', () => {
    expect(gridPlacement('07:00', '08:00')).toEqual({ row: 1, span: 4 });
    expect(gridPlacement('09:15', '10:00')).toEqual({ row: 10, span: 3 });
    expect(gridPlacement('09:10', '09:20')).toEqual({ row: 9, span: 2 });
  });
  it('clamps bookings outside the grid', () => {
    expect(gridPlacement('05:00', '07:30')).toEqual({ row: 1, span: 2 });
    expect(gridPlacement('19:30', '22:00')).toEqual({ row: 51, span: 2 });
  });
  it('labels each hour', () => {
    const labels = timeLabels();
    expect(labels).toHaveLength((GRID_END - GRID_START) / SLOT_MINUTES);
    expect(labels[0]).toBe('07:00');
    expect(labels[1]).toBe('');
    expect(labels[4]).toBe('08:00');
  });
});

import { describe, it, expect } from 'vitest';
import { GRID_END, GRID_START, SLOT_MINUTES, gridPlacement, gridRange, minutesOfDay, timeLabels } from './time';

const DEFAULT = { start: GRID_START, end: GRID_END };
const m = minutesOfDay;

describe('schedule grid', () => {
  it('converts clock times', () => {
    expect(minutesOfDay('07:00')).toBe(420);
    expect(minutesOfDay('13:45')).toBe(825);
  });
  it('places bookings on 15-minute rows (row 1 = 07:00)', () => {
    expect(gridPlacement('07:00', '08:00', DEFAULT)).toEqual({ row: 1, span: 4 });
    expect(gridPlacement('09:15', '10:00', DEFAULT)).toEqual({ row: 10, span: 3 });
    expect(gridPlacement('09:10', '09:20', DEFAULT)).toEqual({ row: 9, span: 2 });
  });
  it('clamps bookings outside the grid', () => {
    expect(gridPlacement('05:00', '07:30', DEFAULT)).toEqual({ row: 1, span: 2 });
    expect(gridPlacement('19:30', '22:00', DEFAULT)).toEqual({ row: 51, span: 2 });
  });
  it('labels each hour', () => {
    const labels = timeLabels(DEFAULT);
    expect(labels).toHaveLength((GRID_END - GRID_START) / SLOT_MINUTES);
    expect(labels[0]).toBe('07:00');
    expect(labels[1]).toBe('');
    expect(labels[4]).toBe('08:00');
  });
});

describe('gridRange', () => {
  it('is 07:00–20:00 without bookings or with bookings inside it', () => {
    expect(gridRange([])).toEqual(DEFAULT);
    expect(gridRange([{ start: m('09:00'), end: m('10:00') }])).toEqual(DEFAULT);
  });
  it('starts at the full hour of an earlier booking', () => {
    expect(gridRange([{ start: m('05:30'), end: m('06:30') }])).toEqual({ start: m('05:00'), end: GRID_END });
  });
  it('ends at the next full hour after a later booking', () => {
    expect(gridRange([{ start: m('21:00'), end: m('22:10') }])).toEqual({ start: GRID_START, end: m('23:00') });
    expect(gridRange([{ start: m('20:00'), end: m('22:00') }])).toEqual({ start: GRID_START, end: m('22:00') });
  });
  it('stretches both ways at once', () => {
    expect(gridRange([
      { start: m('06:15'), end: m('07:00') },
      { start: m('19:00'), end: m('20:45') },
    ])).toEqual({ start: m('06:00'), end: m('21:00') });
  });
  it('treats a booking that runs past midnight as ending at 24:00', () => {
    expect(gridRange([{ start: m('23:00'), end: m('00:30') }])).toEqual({ start: GRID_START, end: 24 * 60 });
  });
});

describe('a stretched grid', () => {
  const range = { start: m('05:00'), end: m('23:00') };
  it('places early and late bookings on their own rows', () => {
    expect(gridPlacement('05:00', '07:30', range)).toEqual({ row: 1, span: 10 });
    expect(gridPlacement('21:00', '22:10', range)).toEqual({ row: 65, span: 5 });
  });
  it('labels from its first hour', () => {
    const labels = timeLabels(range);
    expect(labels).toHaveLength(72);
    expect(labels[0]).toBe('05:00');
    expect(labels[labels.length - 4]).toBe('22:00');
  });
  it('runs a past-midnight booking to the end of the grid', () => {
    expect(gridPlacement('23:00', '00:30', { start: GRID_START, end: 24 * 60 })).toEqual({ row: 65, span: 4 });
  });
});

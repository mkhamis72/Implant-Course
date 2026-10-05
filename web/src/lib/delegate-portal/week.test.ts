import { describe, it, expect } from 'vitest';
import { weekOf } from './week';

describe('weekOf', () => {
  it('runs Saturday to Friday, the clinic week', () => {
    // 2030-03-06 is a Wednesday
    expect(weekOf('2030-03-06')).toEqual({ from: '2030-03-02', to: '2030-03-08', prev: '2030-02-23', next: '2030-03-09' });
  });
  it('starts on the Saturday itself and ends on the Friday itself', () => {
    expect(weekOf('2030-03-02').from).toBe('2030-03-02');
    expect(weekOf('2030-03-08').from).toBe('2030-03-02');
  });
  it('crosses month and year ends', () => {
    expect(weekOf('2031-01-01')).toEqual({ from: '2030-12-28', to: '2031-01-03', prev: '2030-12-21', next: '2031-01-04' });
  });
});

import { describe, it, expect } from 'vitest';
import { withRecorded } from './with-recorded';
import type { Product } from './types';

const implant = (id: string, system: string, d: number, l: number) =>
  ({ id, type: 'implant', brand: 'Oxy Implant', system, platform: '', diameter_mm: d, length_mm: l, description: '' }) as Product;

const a = implant('a', 'PSK-MDK · PSK Micro', 4, 10);
const b = implant('b', 'PSK-MDK · PSK Micro', 4, 11.5);
const off = implant('off', 'PSK-MDK · PSK Micro', 4, 8.5);

describe('withRecorded', () => {
  it('adds a recorded product that is missing from the list, in label order', () => {
    expect(withRecorded([a, b], [off]).map((p) => p.id)).toEqual(['off', 'a', 'b']);
  });

  it('adds each product once and ignores null, undefined and products already listed', () => {
    expect(withRecorded([a], [null, undefined, a, off, off]).map((p) => p.id)).toEqual(['off', 'a']);
  });

  it('returns the list unchanged when nothing is recorded', () => {
    const list = [a, b];
    expect(withRecorded(list, [])).toBe(list);
  });
});

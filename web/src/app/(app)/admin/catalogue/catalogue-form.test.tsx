import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { CatalogGroup } from '@/lib/catalog/group';

vi.mock('./actions', () => ({ saveCatalogue: vi.fn() }));
import { saveCatalogue } from './actions';
import { CatalogueForm } from './catalogue-form';

const row = (itemId: string, label: string, on: boolean, retired = false) => ({ itemId, label, refCode: `REF${itemId}`, on, retired });
const group: CatalogGroup = {
  brands: [{
    brand: 'Oxy Implant', on: 2, total: 4,
    systems: [
      { system: 'MD EXT · Standard', on: 0, total: 1,
        platforms: [{ platform: 'Internal hex', types: [{ type: 'implant', rows: [row('x1', 'Ø4.1 × 10 mm', false)] }] }] },
      { system: 'PSK-MDK · PSK Normo', on: 2, total: 3,
        platforms: [{ platform: 'Standard conical', types: [
          { type: 'implant', rows: [row('n1', 'Ø4.5 × 10 mm', true), row('n2', 'Ø4.5 × 11.5 mm', true), row('n3', 'Ø4.5 × 13 mm', false)] },
          { type: 'healing_abutment', rows: [row('old', 'Cuff 3 mm', true, true)] },
        ] }] },
    ],
  }],
  own: [{ productId: 'own1', label: 'Local · Healing cap', on: true }],
};

const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const sent = () => {
  const fd = vi.mocked(saveCatalogue).mock.calls.at(-1)![1] as FormData;
  return { on: fd.getAll('on_item'), off: fd.getAll('off_item'), onOwn: fd.getAll('on_product'), offOwn: fd.getAll('off_product') };
};

describe('<CatalogueForm>', () => {
  beforeEach(() => vi.mocked(saveCatalogue).mockResolvedValue({ ok: 'Saved: 1 switched on, 0 switched off.' }));

  it('ticks a whole system, and shows a partly ticked system as mixed', () => {
    render(<CatalogueForm group={group} />);
    expect(box('PSK-MDK · PSK Normo').indeterminate).toBe(true);
    fireEvent.click(box('PSK-MDK · PSK Normo'));
    expect(box('Ø4.5 × 13 mm REFn3').checked).toBe(true);
    expect(box('PSK-MDK · PSK Normo').indeterminate).toBe(false);
    fireEvent.click(box('Ø4.5 × 10 mm REFn1'));
    expect(box('PSK-MDK · PSK Normo').indeterminate).toBe(true);
  });

  it('ticks a whole brand but never switches a retired item on', async () => {
    render(<CatalogueForm group={group} />);
    fireEvent.click(box('Oxy Implant'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saveCatalogue).toHaveBeenCalled());
    expect(sent().on.sort()).toEqual(['n3', 'x1']);
    expect(sent().off).toEqual([]);
  });

  it('sends only what changed, own products included', async () => {
    render(<CatalogueForm group={group} />);
    fireEvent.click(box('Ø4.5 × 11.5 mm REFn2'));
    fireEvent.click(box('Cuff 3 mm REFold'));
    fireEvent.click(box('Local · Healing cap'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(saveCatalogue).toHaveBeenCalled());
    expect(sent()).toEqual({ on: [], off: ['n2', 'old'], onOwn: [], offOwn: ['own1'] });
    expect(await screen.findByText('Saved: 1 switched on, 0 switched off.')).toBeInTheDocument();
  });

  it('marks a retired item and does not let it be switched back on', () => {
    render(<CatalogueForm group={group} />);
    expect(screen.getByText('No longer in the catalogue')).toBeInTheDocument();
    fireEvent.click(box('Cuff 3 mm REFold'));
    expect(box('Cuff 3 mm REFold').disabled).toBe(true);
  });

  it('filters by brand, system, platform or ref code', () => {
    render(<CatalogueForm group={group} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find' }), { target: { value: 'normo' } });
    expect(screen.queryByRole('checkbox', { name: 'MD EXT · Standard' })).not.toBeInTheDocument();
    expect(box('Ø4.5 × 13 mm REFn3')).toBeVisible();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Find' }), { target: { value: 'refx1' } });
    expect(box('Ø4.1 × 10 mm REFx1')).toBeVisible();
    expect(screen.queryByRole('checkbox', { name: 'Ø4.5 × 13 mm REFn3' })).not.toBeInTheDocument();
  });
});

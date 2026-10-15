import { availableLots } from './lots';
import { fmtMm } from './labels';
import type { LotOnHand, Product } from './types';

/**
 * The implant picker's steps: brand → line → type → size. Line and type come from the product's
 * system, "PSK-MDK · PSK Micro" (the Oxy catalogue, 0026); a system without " · " is a line with no type.
 */
export type PickerSelection = { brand: string; line: string; type: string };

export function pathOf(p: Pick<Product, 'brand' | 'system'>): PickerSelection {
  const [line, ...rest] = (p.system ?? '').split(' · ');
  return { brand: p.brand, line: line.trim(), type: rest.join(' · ').trim() };
}

/** Units usable on the day (in stock, not expired) per product; products with none are absent. */
export function onHandByProduct(lots: readonly LotOnHand[], usedOn: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of new Set(lots.map((l) => l.product_id))) {
    const n = availableLots(lots, id, usedOn).reduce((sum, l) => sum + l.on_hand, 0);
    if (n > 0) out.set(id, n);
  }
  return out;
}

const uniqueSorted = (values: string[]) =>
  [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
/** The current choice if still offered; the only option if there is one; otherwise nothing. */
const pick = (options: string[], current: string) => (options.length === 1 ? options[0] : options.includes(current) ? current : '');

/**
 * The options of each step for the current selection. With stock counts, products without stock are
 * left out (and so are lines and types left empty), except `keep`, the product already chosen.
 */
export function pickerState(implants: readonly Product[], sel: PickerSelection, stock: Map<string, number> | null, keep: string) {
  const usable = stock ? implants.filter((p) => p.id === keep || (stock.get(p.id) ?? 0) > 0) : [...implants];
  const paths = new Map(usable.map((p) => [p.id, pathOf(p)]));
  const at = (p: Product) => paths.get(p.id)!;

  const brands = uniqueSorted(usable.map((p) => at(p).brand));
  const brand = pick(brands, sel.brand);
  const inBrand = usable.filter((p) => at(p).brand === brand);
  const lines = uniqueSorted(inBrand.map((p) => at(p).line));
  const line = pick(lines, sel.line);
  const inLine = inBrand.filter((p) => at(p).line === line);
  const types = uniqueSorted(inLine.map((p) => at(p).type).filter(Boolean));
  const type = pick(types, sel.type);
  const sizes = types.length === 0 || type
    ? inLine
      .filter((p) => at(p).type === type)
      .sort((a, b) => (a.diameter_mm ?? 0) - (b.diameter_mm ?? 0) || (a.length_mm ?? 0) - (b.length_mm ?? 0))
    : [];
  return { brands, lines, types, sizes, sel: { brand, line, type } };
}

/** "Ø4.0 × 10 mm · 3 in stock"; without a count, just the size. */
export function sizeLabel(p: Pick<Product, 'diameter_mm' | 'length_mm'>, onHand: number | null): string {
  const size = `Ø${fmtMm(p.diameter_mm ?? 0, 1)} × ${fmtMm(p.length_mm ?? 0, 0)} mm`;
  if (onHand === null) return size;
  return `${size} · ${onHand > 0 ? `${onHand} in stock` : 'none in stock'}`;
}

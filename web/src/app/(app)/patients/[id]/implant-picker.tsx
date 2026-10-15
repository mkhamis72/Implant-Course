'use client';

import { useMemo, useState } from 'react';
import { onHandByProduct, pathOf, pickerState, sizeLabel, type PickerSelection } from '@/lib/inventory/implant-picker';
import type { LotOnHand, Product } from '@/lib/inventory/types';

const NONE: PickerSelection = { brand: '', line: '', type: '' };

/**
 * The implant in steps (brand when there are several, line, type, size) instead of one long list.
 * "In stock only" hides sizes with no stock usable on `usedOn`; the chosen product always stays listed.
 */
export function ImplantPicker({ implants, lots, usedOn, value, onChange, required = false, inStockDefault }: {
  implants: Product[]; lots: LotOnHand[]; usedOn: string; value: string; onChange: (productId: string) => void;
  required?: boolean; inStockDefault: boolean;
}) {
  const stock = useMemo(() => onHandByProduct(lots, usedOn), [lots, usedOn]);
  const chosen = implants.find((p) => p.id === value);
  const [sel, setSel] = useState<PickerSelection>(chosen ? pathOf(chosen) : NONE);
  const [inStock, setInStock] = useState(inStockDefault);
  const s = pickerState(implants, sel, inStock ? stock : null, value);

  // A new brand, line or type clears the size when the chosen product no longer fits it.
  function choose(next: PickerSelection) {
    setSel(next);
    if (value && !pickerState(implants, next, inStock ? stock : null, value).sizes.some((p) => p.id === value)) onChange('');
  }
  const step = (label: string, placeholder: string, current: string, options: string[], onPick: (v: string) => void) => (
    <select className="input" aria-label={label} value={current} onChange={(e) => onPick(e.target.value)}>
      <option value="">{placeholder}</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  // In-stock filtering drops empty lines and types, so nothing to show means no line at all.
  const emptyHere = inStock && s.lines.length === 0;

  return (
    <fieldset className="space-y-2">
      <legend className="label">
        {required ? 'Implant' : 'Implant (optional)'}
        {required && <span aria-hidden="true" className="text-bad"> *</span>}
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {s.brands.length > 1 && step('Implant brand', 'Brand…', s.sel.brand, s.brands, (brand) => choose({ brand, line: '', type: '' }))}
        {step('Implant line', 'Line…', s.sel.line, s.lines, (line) => choose({ ...s.sel, line, type: '' }))}
        {s.types.length > 0 && step('Implant type', 'Type…', s.sel.type, s.types, (type) => choose({ ...s.sel, type }))}
        <select
          className="input"
          aria-label="Implant size"
          aria-required={required}
          value={value}
          disabled={s.sizes.length === 0}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{required ? 'Size…' : 'Size: not chosen yet'}</option>
          {s.sizes.map((p) => <option key={p.id} value={p.id}>{sizeLabel(p, stock.get(p.id) ?? 0)}</option>)}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={inStock}
          // Keep the steps shown, including ones filled in because they were the only option.
          onChange={(e) => { setSel(s.sel); setInStock(e.target.checked); }}
        />
        In stock only
      </label>
      {emptyHere && (
        <p className="text-sm text-muted">Nothing in stock here. Untick <em>In stock only</em> to see every size.</p>
      )}
    </fieldset>
  );
}

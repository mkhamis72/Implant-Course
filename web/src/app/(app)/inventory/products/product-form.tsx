'use client';

import { useActionState } from 'react';
import { PRODUCT_TYPES, PRODUCT_TYPE_LABELS, type Product } from '@/lib/inventory/types';
import { checkedOf, valueOf, type FormState } from '@/lib/patients/form-state';

type Props = {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  product?: Product;
};

export function ProductForm({ action, product }: Props) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const v = (key: keyof Product) => {
    const raw = product?.[key];
    return valueOf(state, key, raw === null || raw === undefined ? '' : String(raw));
  };
  // A product switched on from the catalogue library (0128) keeps the library's fields.
  const locked = !!product?.catalog_item_id;
  return (
    <form action={formAction} className="card grid max-w-3xl gap-4 sm:grid-cols-3">
      {product && <input type="hidden" name="id" value={product.id} readOnly />}
      {locked && <p className="text-sm text-muted sm:col-span-3">From the catalogue library.</p>}
      <label className="block">
        <span className="label">Type</span>
        <select className="input" name="type" disabled={locked} defaultValue={v('type') || 'implant'}>
          {PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>
              {PRODUCT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="label">Brand</span>
        <input className="input" name="brand" disabled={locked} defaultValue={v('brand')} />
      </label>
      <label className="block">
        <span className="label">System</span>
        <input className="input" name="system" disabled={locked} defaultValue={v('system')} />
      </label>
      <label className="block">
        <span className="label">Diameter (mm)</span>
        <input className="input" name="diameter_mm" disabled={locked} inputMode="decimal" defaultValue={v('diameter_mm')} />
      </label>
      <label className="block">
        <span className="label">Length (mm)</span>
        <input className="input" name="length_mm" disabled={locked} inputMode="decimal" defaultValue={v('length_mm')} />
      </label>
      <label className="block">
        <span className="label">Platform</span>
        <input className="input" name="platform" disabled={locked} defaultValue={v('platform')} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Description</span>
        <input className="input" name="description" disabled={locked} defaultValue={v('description')} />
      </label>
      <label className="block">
        <span className="label">Reference code</span>
        <input className="input" name="ref_code" disabled={locked} defaultValue={v('ref_code')} />
      </label>
      <label className="block">
        <span className="label">Reorder level</span>
        <input className="input" name="reorder_level" inputMode="numeric" defaultValue={v('reorder_level') || '0'} />
      </label>
      {product && (
        <div className="flex flex-col justify-end gap-2 text-sm sm:col-span-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" name="active" defaultChecked={checkedOf(state, 'active', product.active)} />
            Active (offered when receiving and placing)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="is_sample" defaultChecked={checkedOf(state, 'is_sample', product.is_sample)} />
            Sample entry — not yet verified against the supplier
          </label>
        </div>
      )}
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-3">{state.error}</p>}
      {state.ok && <p className="text-sm text-ok sm:col-span-3">{state.ok}</p>}
      <div className="sm:col-span-3">
        <button className="btn" disabled={pending}>
          Save product
        </button>
      </div>
    </form>
  );
}

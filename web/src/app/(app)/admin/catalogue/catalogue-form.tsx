'use client';

import { useActionState, useState } from 'react';
import type { CatalogGroup, CatalogRow } from '@/lib/catalog/group';
import { PRODUCT_TYPE_LABELS } from '@/lib/inventory/types';
import { saveCatalogue } from './actions';

type Tick = 'on' | 'off' | 'mixed';

function TickBox({ label, tick, onToggle, disabled = false }: {
  label: string; tick: Tick; onToggle: () => void; disabled?: boolean;
}) {
  return (
    <input
      type="checkbox"
      aria-label={label}
      className="size-5 shrink-0"
      checked={tick === 'on'}
      disabled={disabled}
      ref={(el) => { if (el) el.indeterminate = tick === 'mixed'; }}
      onChange={onToggle}
    />
  );
}

/** Admin → Catalogue (0128): tick boxes per brand, system and product; Save sends only what changed. */
export function CatalogueForm({ group }: { group: CatalogGroup }) {
  const [state, action, pending] = useActionState(saveCatalogue, {});
  // Changes not saved yet, over what the page loaded: item / product id → on.
  const [items, setItems] = useState<Record<string, boolean>>({});
  const [own, setOwn] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState<Record<string, boolean>>(group.brands[0] ? { [group.brands[0].brand]: true } : {});
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const isOn = (r: CatalogRow) => items[r.itemId] ?? r.on;
  const tickOf = (rows: CatalogRow[]): Tick => {
    const live = rows.filter((r) => !r.retired);
    const on = live.filter(isOn).length;
    return on === 0 ? 'off' : on === live.length ? 'on' : 'mixed';
  };
  // A brand or system tick switches its live items: all on, or all off when all are on already.
  const toggleAll = (rows: CatalogRow[]) => {
    const live = rows.filter((r) => !r.retired);
    const next = tickOf(rows) !== 'on';
    setItems((m) => ({ ...m, ...Object.fromEntries(live.map((r) => [r.itemId, next])) }));
  };

  const changed = (base: { id: string; on: boolean }[], over: Record<string, boolean>, on: boolean) =>
    base.filter((b) => over[b.id] !== undefined && over[b.id] !== b.on && over[b.id] === on).map((b) => b.id);
  const allRows = group.brands.flatMap((b) => b.systems.flatMap((s) => s.platforms.flatMap((p) => p.types.flatMap((t) => t.rows))));
  const itemBase = allRows.map((r) => ({ id: r.itemId, on: r.on }));
  const ownBase = group.own.map((o) => ({ id: o.productId, on: o.on }));
  const pendingCount = changed(itemBase, items, true).length + changed(itemBase, items, false).length
    + changed(ownBase, own, true).length + changed(ownBase, own, false).length;

  const matches = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));

  return (
    <form action={action} className="space-y-4">
      {changed(itemBase, items, true).map((id) => <input key={`on-${id}`} type="hidden" name="on_item" value={id} />)}
      {changed(itemBase, items, false).map((id) => <input key={`off-${id}`} type="hidden" name="off_item" value={id} />)}
      {changed(ownBase, own, true).map((id) => <input key={`onp-${id}`} type="hidden" name="on_product" value={id} />)}
      {changed(ownBase, own, false).map((id) => <input key={`offp-${id}`} type="hidden" name="off_product" value={id} />)}

      <div className="flex flex-wrap items-end gap-3">
        <label className="grow">
          <span className="label">Find</span>
          <input type="search" aria-label="Find" className="input w-full" placeholder="Brand, system, connection or ref code"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="submit" className="btn" disabled={pending || pendingCount === 0}>Save</button>
      </div>
      {state.ok && <p role="status" className="text-sm text-ok">{state.ok}</p>}
      {state.error && <p role="alert" className="text-sm text-bad">{state.error}</p>}

      {group.brands.map((brand) => {
        const brandRows = brand.systems.flatMap((s) => s.platforms.flatMap((p) => p.types.flatMap((t) => t.rows)));
        const systems = brand.systems.map((s) => ({
          ...s,
          platforms: s.platforms.map((p) => ({
            ...p,
            types: p.types.map((t) => ({
              ...t, rows: t.rows.filter((r) => matches(brand.brand, s.system, p.platform, r.refCode, r.label)),
            })).filter((t) => t.rows.length),
          })).filter((p) => p.types.length),
        })).filter((s) => s.platforms.length);
        if (systems.length === 0) return null;
        const expanded = !!q || !!open[brand.brand];
        const liveOn = brandRows.filter((r) => !r.retired && isOn(r)).length;
        return (
          <section key={brand.brand} className="card space-y-3">
            <div className="flex items-center gap-3">
              <TickBox label={brand.brand} tick={tickOf(brandRows)} onToggle={() => toggleAll(brandRows)} />
              <h2 className="grow text-base font-semibold">{brand.brand}</h2>
              <span className="text-sm text-muted">{liveOn} of {brand.total} on</span>
              {!q && (
                <button type="button" className="btn-secondary btn" aria-expanded={expanded}
                  onClick={() => setOpen((m) => ({ ...m, [brand.brand]: !expanded }))}>
                  {expanded ? 'Hide' : 'Show'}
                </button>
              )}
            </div>
            {expanded && systems.map((system) => {
              const full = brand.systems.find((s) => s.system === system.system)!;
              const sysRows = full.platforms.flatMap((p) => p.types.flatMap((t) => t.rows));
              return (
                <div key={system.system} className="space-y-2 border-t border-line pt-3">
                  <div className="flex items-center gap-3">
                    <TickBox label={system.system || 'No system'} tick={tickOf(sysRows)} onToggle={() => toggleAll(sysRows)} />
                    <h3 className="grow font-medium">{system.system || 'No system'}</h3>
                    <span className="text-sm text-muted">{sysRows.filter((r) => !r.retired && isOn(r)).length} of {full.total} on</span>
                  </div>
                  {system.platforms.map((platform) => (
                    <div key={platform.platform} className="space-y-1 pl-8">
                      {platform.platform && <p className="text-sm font-medium text-muted">{platform.platform}</p>}
                      {platform.types.map((t) => (
                        <fieldset key={t.type} className="space-y-1">
                          <legend className="text-xs uppercase text-muted">{PRODUCT_TYPE_LABELS[t.type]}</legend>
                          {t.rows.map((r) => (
                            <div key={r.itemId} className="flex flex-wrap items-center gap-2 py-1">
                              <label className="flex items-center gap-2">
                                <input type="checkbox" className="size-5 shrink-0" checked={isOn(r)}
                                  disabled={r.retired && !isOn(r)}
                                  onChange={() => setItems((m) => ({ ...m, [r.itemId]: !isOn(r) }))} />
                                <span>{r.label}</span> <span className="text-sm text-muted">{r.refCode}</span>
                              </label>
                              {r.retired && <span className="badge badge-warn">No longer in the catalogue</span>}
                            </div>
                          ))}
                        </fieldset>
                      ))}
                    </div>
                  ))}
                </div>
              );
            })}
          </section>
        );
      })}

      {group.own.some((o) => matches(o.label)) && (
        <section className="card space-y-2">
          <h2 className="text-base font-semibold">Your own products</h2>
          {group.own.filter((o) => matches(o.label)).map((o) => (
            <label key={o.productId} className="flex items-center gap-2 py-1">
              <input type="checkbox" className="size-5 shrink-0" checked={own[o.productId] ?? o.on}
                onChange={() => setOwn((m) => ({ ...m, [o.productId]: !(m[o.productId] ?? o.on) }))} />
              <span>{o.label}</span>
            </label>
          ))}
        </section>
      )}
    </form>
  );
}

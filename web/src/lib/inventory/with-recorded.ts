import { productLabel } from './labels';
import type { Product } from './types';

/** The dropdown's products plus any product a record already holds (a planned implant or a spare switched off in
 *  Admin → Catalogue since), so it still shows and can be chosen. Sorted by label when anything was added. */
export function withRecorded(list: Product[], recorded: (Product | null | undefined)[]): Product[] {
  const ids = new Set(list.map((p) => p.id));
  const added: Product[] = [];
  for (const p of recorded) {
    if (p && !ids.has(p.id)) {
      ids.add(p.id);
      added.push(p);
    }
  }
  if (added.length === 0) return list;
  return [...list, ...added].sort((x, y) => productLabel(x).localeCompare(productLabel(y), undefined, { numeric: true }));
}

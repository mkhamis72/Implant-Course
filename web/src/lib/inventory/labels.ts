import { PRODUCT_TYPE_LABELS, type LotOnHand, type Product } from './types';

/** 4 → "4.0" (minDecimals 1), 3.75 → "3.75", 10 → "10" (minDecimals 0), 11.5 → "11.5". */
export function fmtMm(n: number, minDecimals: number): string {
  const s = String(Number(n));
  const decimals = s.includes('.') ? s.split('.')[1].length : 0;
  return Number(n).toFixed(Math.max(decimals, minDecimals));
}

type LabelInput = Pick<Product, 'type' | 'brand' | 'system' | 'platform' | 'description' | 'diameter_mm' | 'length_mm'>;

export function productLabel(p: LabelInput): string {
  const head = [p.brand, p.system].filter(Boolean).join(' ');
  if (p.type === 'implant' && p.diameter_mm !== null && p.length_mm !== null) {
    return `${head} Ø${fmtMm(p.diameter_mm, 1)} × ${fmtMm(p.length_mm, 0)} mm`;
  }
  return [head, p.platform, p.description || PRODUCT_TYPE_LABELS[p.type]].filter(Boolean).join(' · ');
}

export function lotLabel(lot: Pick<LotOnHand, 'lot_no' | 'expiry' | 'on_hand'>): string {
  const name = lot.lot_no ? `Lot ${lot.lot_no}` : 'No lot';
  return `${name}${lot.expiry ? ` · exp ${lot.expiry}` : ''} · ${lot.on_hand} left`;
}

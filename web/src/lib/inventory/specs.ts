import type { Product } from './types';

export type Spec = { label: string; value: string };

/** Up to two decimals, no trailing zeros: 17, 17.5. */
const plain = (n: number) => String(Math.round(n * 100) / 100);

/** The filled specs of a product (0134), ready to show; empty ones are left out. */
export function productSpecs(p: Product): Spec[] {
  const specs: Spec[] = [];
  const add = (label: string, value: string) => { if (value) specs.push({ label, value }); };
  add('Connection', p.connection.trim());
  add('Gingival height', p.gingival_height_mm === null ? '' : `${p.gingival_height_mm.toFixed(1)} mm`);
  add('Angle', p.angle_deg === null ? '' : `${plain(p.angle_deg)}°`);
  add('Material', p.material.trim());
  const driver = [p.driver_interface.trim(), p.driver_size.trim()].filter(Boolean).join(' ');
  const ref = p.driver_ref.trim();
  add('Screwdriver', ref ? (driver ? `${driver} · ref ${ref}` : `ref ${ref}`) : driver);
  add('Recommended torque', p.torque_ncm === null ? '' : `${plain(p.torque_ncm)} Ncm`);
  return specs;
}

/** One line for pickers and lists: "Label: value · Label: value", empty when no spec is filled. */
export function specsLine(p: Product): string {
  return productSpecs(p).map((s) => `${s.label}: ${s.value}`).join(' · ');
}

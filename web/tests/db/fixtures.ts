import type { Client } from 'pg';

export async function makePatient(c: Client, name = 'Inventory Patient'): Promise<string> {
  const { rows } = await c.query('insert into public.patients (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

export async function makeDelegate(c: Client, name = 'Test Delegate'): Promise<string> {
  const { rows } = await c.query('insert into public.delegates (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

export async function makeProduct(c: Client, type = 'implant', brand = 'Test Brand'): Promise<string> {
  const implant = type === 'implant';
  const { rows } = await c.query(
    `insert into public.products (type, brand, system, diameter_mm, length_mm)
     values ($1, $2, 'T1', $3, $4) returning id`,
    [type, brand, implant ? 4.0 : null, implant ? 10 : null],
  );
  return rows[0].id;
}

export async function receive(
  c: Client,
  product: string,
  qty: number,
  lot: string | null = 'L1',
  expiry: string | null = null,
): Promise<string> {
  const { rows } = await c.query(
    'select public.receive_stock(p_product => $1, p_qty => $2, p_lot_no => $3, p_expiry => $4) as id',
    [product, qty, lot, expiry],
  );
  return rows[0].id;
}

export async function onHand(c: Client, lot: string): Promise<number> {
  const { rows } = await c.query('select on_hand from public.stock_on_hand where stock_lot_id = $1', [lot]);
  return rows[0].on_hand;
}

export async function place(
  c: Client,
  a: { patient: string; tooth: number; product: string; lot: string; delegate: string; supervisor: string; assistant?: string; placedOn?: string },
): Promise<string> {
  const { rows } = await c.query(
    `select public.place_implant(
       p_patient => $1, p_tooth => $2::smallint, p_product => $3, p_lot => $4,
       p_placed_on => coalesce($5::date, current_date), p_placing_delegate => $6, p_supervisor => $7,
       p_assisting_delegate => $8) as id`,
    [a.patient, a.tooth, a.product, a.lot, a.placedOn ?? null, a.delegate, a.supervisor, a.assistant ?? null],
  );
  return rows[0].id;
}

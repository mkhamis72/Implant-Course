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

import type { Client } from 'pg';

export async function makePatient(c: Client, name = 'Inventory Patient'): Promise<string> {
  const { rows } = await c.query('insert into public.patients (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

export async function makeDelegate(c: Client, name = 'Test Delegate'): Promise<string> {
  const { rows } = await c.query('insert into public.delegates (full_name) values ($1) returning id', [name]);
  return rows[0].id;
}

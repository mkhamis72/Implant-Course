import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { TEST_PASSWORD } from '../support/test-users';

/** A Supabase client signed in as a test user: goes through the same RLS and functions as the app. */
export async function apiAs(email: string): Promise<SupabaseClient> {
  const api = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await api.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (error) throw error;
  return api;
}

export async function seedProduct(
  api: SupabaseClient,
  fields: { type: string; brand: string; system?: string; description?: string; diameter_mm?: number; length_mm?: number },
): Promise<string> {
  const { data, error } = await api.from('products').insert({ system: 'E2E', ...fields }).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function receiveStock(
  api: SupabaseClient,
  product: string,
  qty: number,
  lot: string | null,
  expiry: string | null,
): Promise<string> {
  const { data, error } = await api.rpc('receive_stock', { p_product: product, p_qty: qty, p_lot_no: lot, p_expiry: expiry });
  if (error) throw error;
  return data as string;
}

export async function seedImplantStock(
  api: SupabaseClient,
  o: { brand: string; qty: number; lot: string | null; expiry: string | null },
): Promise<{ productId: string; lotId: string }> {
  const productId = await seedProduct(api, { type: 'implant', brand: o.brand, diameter_mm: 4, length_mm: 10 });
  const lotId = await receiveStock(api, productId, o.qty, o.lot, o.expiry);
  return { productId, lotId };
}

export async function seedDelegate(api: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await api.from('delegates').insert({ full_name: name }).select('id').single();
  if (error) throw error;
  return data.id;
}

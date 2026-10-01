import { createClient } from '@/lib/supabase/server';
import type { Chair } from '@/lib/schedule/types';
import { AddChair, ChairRow } from './chair-row';

export default async function ChairsPage() {
  const supabase = await createClient();
  const { data, error } = await supabase.from('chairs').select('id, name, active').order('name');
  if (error) throw new Error('Could not load chairs');
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Chairs</h1>
      <AddChair />
      <ul className="card">
        {((data ?? []) as Chair[]).map((chair) => (
          <ChairRow key={chair.id} chair={chair} />
        ))}
      </ul>
    </div>
  );
}

import { createClient } from '@/lib/supabase/server';
import { isFdiTooth } from '@/lib/patients/fdi';
import type { ToothState } from '@/lib/patients/types';
import { ChartPanel } from './chart-panel';

export default async function PatientChartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tooth?: string }>;
}) {
  const { id } = await params;
  const { tooth } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from('tooth_status').select('tooth, status').eq('patient_id', id);
  if (error) throw new Error('Could not load the chart');
  const statuses: Partial<Record<number, ToothState>> = {};
  for (const row of data ?? []) statuses[row.tooth as number] = row.status as ToothState;
  const initial = Number(tooth);
  return <ChartPanel patientId={id} statuses={statuses} initialTooth={isFdiTooth(initial) ? initial : null} />;
}

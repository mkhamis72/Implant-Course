import { requirePermission } from '@/lib/auth/session';
import { isFdiTooth } from '@/lib/patients/fdi';
import { ChartPanel } from './chart-panel';
import { loadChartData } from './chart-data';
import { readParams, type PageSearchParams } from '@/lib/search-params';

export default async function PatientChartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: PageSearchParams;
}) {
  await requirePermission('patients');
  const { id } = await params;
  const tooth = (await readParams(searchParams, 'tooth')).tooth || undefined;
  const data = await loadChartData(id);
  const initial = Number(tooth);
  return <ChartPanel patientId={id} data={data} initialTooth={isFdiTooth(initial) ? initial : null} />;
}

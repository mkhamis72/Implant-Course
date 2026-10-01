import { isFdiTooth } from '@/lib/patients/fdi';
import { ChartPanel } from './chart-panel';
import { loadChartData } from './chart-data';

export default async function PatientChartPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tooth?: string }>;
}) {
  const { id } = await params;
  const { tooth } = await searchParams;
  const data = await loadChartData(id);
  const initial = Number(tooth);
  return <ChartPanel patientId={id} data={data} initialTooth={isFdiTooth(initial) ? initial : null} />;
}

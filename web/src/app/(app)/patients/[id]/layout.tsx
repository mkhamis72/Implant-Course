import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

export default async function PatientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const { data: patient } = await supabase.from('patients').select('full_name, file_no').eq('id', id).maybeSingle();
  if (!patient) notFound();
  return (
    <div className="space-y-6">
      <div data-testid="patient-header">
        <h1 className="text-2xl font-semibold">{patient.full_name}</h1>
        <p className="text-sm text-gray-600">File {patient.file_no}</p>
      </div>
      {children}
    </div>
  );
}

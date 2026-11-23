import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { formatTime } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import type { Option, Product, Technique } from '@/lib/inventory/types';
import { SLOT_SELECT } from '@/lib/schedule/queries';
import type { BookingPatient, SlotRow } from '@/lib/schedule/types';
import type { EditImplantRow } from '@/lib/schedule/schemas';
import { SlotForm } from '../../new/slot-form';
import { teachingOn } from '@/lib/modules/modules';
import { sessionLabel } from '@/lib/schedule/labels';
import { placedByRecordedDelegates } from '@/lib/schedule/recorded';

export default async function EditBookingPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePermission('schedule', 'edit');
  const { id } = await params;
  const supabase = await createClient();
  const { data, error } = await supabase.from('surgery_slots').select(SLOT_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error('Could not load the booking');
  if (!data) notFound();
  const slot = data as unknown as SlotRow;
  const { data: session } = await supabase
    .from('sessions').select('id, title, date, course_id, course:courses(name)').eq('id', slot.session_id).single();
  const s = session as unknown as { id: string; title: string; date: string; course_id: string | null; course: { name: string } | null };
  const teaching = teachingOn(me.features);
  const back = `/schedule?date=${s.date}`;

  if (slot.status !== 'scheduled') {
    return (
      <div className="space-y-4">
        <h1>Edit booking</h1>
        <p className="card text-muted">
          Only scheduled surgeries can be edited. {slot.status === 'done' && 'Reopen the booking on the schedule first.'}
        </p>
        <Link href={back} className="text-accent hover:underline">Back to the schedule</Link>
      </div>
    );
  }

  const none = Promise.resolve({ data: [], error: null });
  const results = await Promise.all([
    supabase.from('chairs').select('id, name').or(`active.eq.true,id.eq.${slot.chair_id}`).order('name'),
    // A clinic has no delegates or supervisors (a clinic day has no course either).
    teaching && s.course_id
      ? supabase.from('enrollments').select('course_id, delegate:delegates(id, full_name, active)').eq('course_id', s.course_id)
      : none,
    !teaching
      ? none
      : slot.supervisor_id
      ? supabase.from('supervisors').select('id, full_name').or(`active.eq.true,id.eq.${slot.supervisor_id}`).order('full_name')
      : supabase.from('supervisors').select('id, full_name').eq('active', true).order('full_name'),
    teaching ? supabase.from('slot_delegates').select('delegate_id, role').eq('slot_id', id) : none,
    slot.placing_doctor_id
      ? supabase.from('doctors').select('id, name').or(`active.eq.true,id.eq.${slot.placing_doctor_id}`).order('name')
      : supabase.from('doctors').select('id, name').eq('active', true).order('name'),
    supabase.from('products').select('*').eq('type', 'implant').eq('active', true),
    // Every site the booking holds, placed ones included: they go back to set_booking_implants as recorded (0126).
    supabase.from('implant_sites').select('tooth, state, product_id, technique, product:products!implant_sites_product_id_fkey(*)').eq('slot_id', id),
  ]);
  if (results.some((r) => r.error)) throw new Error('Could not load the booking form');
  const [
    { data: chairs }, { data: enrollments }, { data: supervisors }, { data: slotDelegates }, { data: doctors },
    { data: activeImplants }, { data: siteRows },
  ] = results;
  // The patient card: the booking's own patient (its age and phone when they can be read).
  const { data: card } = slot.patient
    ? await supabase.from('patients').select('id, file_no, full_name, dob, phone').eq('id', slot.patient.id).maybeSingle()
    : { data: null };
  const patient: BookingPatient | null = (card as BookingPatient | null)
    ?? (slot.patient ? { ...slot.patient, dob: null, phone: null } : null);
  type Site = { tooth: number; state: string; product_id: string | null; technique: Technique | null; product: Product | null };
  const sites = (siteRows ?? []) as unknown as Site[];

  // Spares by tooth, in position order (the embed is unordered).
  const spares = new Map<number, string[]>();
  for (const sp of [...slot.spares].sort((a, b) => a.tooth - b.tooth || a.position - b.position)) {
    if (sp.product) spares.set(sp.tooth, [...(spares.get(sp.tooth) ?? []), sp.product.id]);
  }
  // One row per tooth: the planned list, plus any site the booking holds without one. The site is the record.
  const teeth = [...new Set([...slot.implants.map((i) => i.tooth), ...sites.map((x) => x.tooth)])].sort((a, b) => a - b);
  const rows: EditImplantRow[] = teeth.map((tooth) => {
    const site = sites.find((x) => x.tooth === tooth);
    const planned = slot.implants.find((i) => i.tooth === tooth);
    return {
      tooth: String(tooth),
      productId: (site ? site.product_id : planned?.product?.id) ?? '',
      technique: site?.technique ?? '',
      spares: spares.get(tooth) ?? [],
      placed: !!site && site.state !== 'planned',
    };
  });
  // The catalogue, plus any implant the booking records that has since left it, so it still shows.
  const products = new Map(((activeImplants ?? []) as Product[]).map((pr) => [pr.id, pr]));
  for (const pr of [...sites.map((x) => x.product), ...slot.implants.map((i) => i.product), ...slot.spares.map((x) => x.product)]) {
    if (pr && !products.has(pr.id)) products.set(pr.id, pr);
  }
  const implantList = [...products.values()].sort((a, b) => productLabel(a).localeCompare(productLabel(b), undefined, { numeric: true }));

  const delegates: Option[] = ((enrollments ?? []) as unknown as { delegate: { id: string; full_name: string; active: boolean } | null }[])
    .filter((e) => e.delegate?.active)
    .map((e) => ({ id: e.delegate!.id, label: e.delegate!.full_name }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const roles = Object.fromEntries(
    ((slotDelegates ?? []) as { delegate_id: string; role: 'placing' | 'assisting' }[]).map((d) => [d.delegate_id, d.role]),
  );

  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1>Edit booking</h1>
        <Link href={back} className="text-accent hover:underline">Back to the schedule</Link>
      </div>
      <SlotForm
        sessions={[{ id: s.id, courseId: s.course_id ?? '', label: '' }]}
        chairs={(chairs ?? []).map((c) => ({ id: c.id as string, label: c.name as string }))}
        canOpenFile={canView(me, 'patients')}
        enrolled={s.course_id ? { [s.course_id]: delegates } : {}}
        implants={implantList}
        supervisors={(supervisors ?? []).map((o) => ({ id: o.id as string, label: o.full_name as string }))}
        doctors={(doctors ?? []).map((d) => ({ id: d.id as string, label: d.name as string }))}
        teaching={teaching}
        me={me.user_id}
        initial={{ sessionId: s.id, chairId: slot.chair_id, start: formatTime(slot.starts_at) }}
        edit={{
          slotId: slot.id,
          sessionId: s.id,
          sessionLabel: sessionLabel(s),
          patient,
          chairId: slot.chair_id,
          supervisorId: slot.supervisor_id ?? '',
          placingDoctorId: slot.placing_doctor_id ?? '',
          placedByRecorded: !teaching && placedByRecordedDelegates(slot),
          start: formatTime(slot.starts_at),
          end: formatTime(slot.ends_at),
          roles,
          implants: rows,
          notes: slot.notes,
          date: s.date,
          setting: slot.setting ?? '',
        }}
      />
    </div>
  );
}

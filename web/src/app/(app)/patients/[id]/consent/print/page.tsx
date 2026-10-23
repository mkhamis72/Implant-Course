import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePermission } from '@/lib/auth/session';
import { getBranding } from '@/lib/branding/get';
import { readParams, type PageSearchParams } from '@/lib/search-params';
import { todayIso } from '@/lib/dates';
import { formatDate } from '@/lib/format';
import { CONSENT_LANGUAGE_LABELS, CONSENT_LANGUAGES, type ConsentLanguage } from '@/lib/consent/labels';
import { ConsentDocument, type PrintableVersion } from '@/components/consent-document';
import { PrintButton } from '@/app/(app)/schedule/pull-list/print-button';

export default async function ConsentPrintPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: PageSearchParams }) {
  await requirePermission('patients');
  const { id } = await params;
  const q = await readParams(searchParams, 'lang', 'course');
  const language: ConsentLanguage = q.lang === 'ar' ? 'ar' : 'en';
  const supabase = await createClient();
  const [patient, courses, version, branding] = await Promise.all([
    supabase.from('patients').select('full_name, file_no').eq('id', id).maybeSingle<{ full_name: string; file_no: string }>(),
    supabase.rpc('patient_course_options', { p_patient: id }),
    supabase.rpc('current_consent_version').maybeSingle<PrintableVersion>(),
    getBranding(),
  ]);
  if (patient.error || courses.error || version.error) throw new Error('Could not load the consent form');
  if (!patient.data) notFound();
  const courseList = (courses.data ?? []) as { id: string; name: string }[];
  const course = courseList.find((c) => c.id === q.course) ?? null;

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label htmlFor="consent-lang" className="label">Language</label>
          <select id="consent-lang" name="lang" defaultValue={language} className="input">
            {CONSENT_LANGUAGES.map((l) => <option key={l} value={l}>{CONSENT_LANGUAGE_LABELS[l]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="consent-course" className="label">Course</label>
          <select id="consent-course" name="course" defaultValue={course?.id ?? ''} className="input">
            <option value="">No course (blank line)</option>
            {courseList.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button type="submit" className="btn-secondary btn">Show</button>
        <PrintButton />
        <Link href={`/patients/${id}/consent`} className="text-accent hover:underline">Back to consent</Link>
      </form>
      {version.data ? (
        <ConsentDocument
          version={version.data}
          language={language}
          values={{
            company_name: branding.name,
            patient_name: patient.data.full_name,
            file_no: patient.data.file_no,
            course_name: course?.name ?? null,
            date: formatDate(todayIso()),
          }}
        />
      ) : (
        <p className="text-muted">No consent form version is in effect yet. An admin adds one in Admin → Settings → Consent.</p>
      )}
    </div>
  );
}

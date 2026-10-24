import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { todayIso } from '@/lib/dates';
import { RESEARCH_FILTER_KEYS, rpcArgs, type ResearchFilters } from '@/lib/research/view';
import { TABLE_NAMES, assertAllowlisted, exportOrder, type ExportTables } from '@/lib/research/export/dictionary';
import type { ExportMeta, StudyAbout } from '@/lib/research/export/assemble';
import { exportFileName } from '@/lib/research/export/assemble';
import { fetchAll } from '@/lib/research/export/fetch-all';
import { consentCounts, mergeConsent } from '@/lib/research/consent';
import { buildXlsx } from '@/lib/research/export/xlsx';
import { buildZip } from '@/lib/research/export/zip';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.active || profile.mfa_setup_required || !canView(profile, 'research')) return new NextResponse('Not allowed', { status: 403 });
  // The readers are security invoker over patient tables: without Patients view the file would be silently empty.
  if (!canView(profile, 'patients')) return new NextResponse('Research export needs View on Patients', { status: 403 });

  const params = new URL(req.url).searchParams;
  const format = params.get('format');
  if (format !== 'xlsx' && format !== 'csv') return new NextResponse('Unknown format', { status: 400 });

  const filters = Object.fromEntries(RESEARCH_FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as ResearchFilters;
  const args = rpcArgs(filters);
  const supabase = await createClient();

  // The study is a label only: it names the export in the about sheet and the log, and doesn't change the implants.
  // Only the four exported fields are read (never the notes).
  const studyId = params.get('study')?.trim() || null;
  let study: StudyAbout | null = null;
  if (studyId) {
    if (!UUID.test(studyId)) return new NextResponse('Study not found', { status: 400 });
    const { data, error } = await supabase.from('studies').select('title, committee, approval_number, protocol_version').eq('id', studyId).maybeSingle<StudyAbout>();
    if (error) {
      console.error('Research export failed', error.message);
      return new NextResponse('Could not build the export', { status: 500 });
    }
    if (!data) return new NextResponse('Study not found', { status: 400 });
    study = data;
  }

  // Store every study code the readers need in one ordered insert first, then run the readers one at a time:
  // they only read codes, so exports can't deadlock on first-time code inserts. All plain POST calls (volatile).
  const assigned = await supabase.rpc('assign_research_codes', args);
  if (assigned.error) {
    console.error('Research export failed', assigned.error.message);
    return new NextResponse('Could not build the export', { status: 500 });
  }
  const results: Record<string, unknown>[][] = [];
  for (const t of TABLE_NAMES) {
    const r = await fetchAll(supabase, `research_export_${t}`, args, exportOrder(t));
    if (r.error) {
      console.error('Research export failed', r.error.message);
      return new NextResponse('Could not build the export', { status: 500 });
    }
    results.push(r.data);
  }
  // Research consent of the same patients, merged into the patients table by study code.
  const consent = await fetchAll(supabase, 'research_export_consent', args, ['patient_code']);
  if (consent.error) {
    console.error('Research export failed', consent.error.message);
    return new NextResponse('Could not build the export', { status: 500 });
  }
  // The files name the course and delegate filters by study code; raw ids go only into the export log.
  const codeOf = async (entity: 'course' | 'delegate', id: string | null) =>
    id ? supabase.rpc('research_code', { p_entity: entity, p_id: id }) : { data: null, error: null };
  const [version, courseCode, delegateCode] = await Promise.all([
    supabase.rpc('outcomes_version'), codeOf('course', args.p_course), codeOf('delegate', args.p_delegate),
  ]);
  const failed = version.error ?? courseCode.error ?? delegateCode.error;
  if (failed) {
    console.error('Research export failed', failed.message);
    return new NextResponse('Could not build the export', { status: 500 });
  }

  const tables = Object.fromEntries(TABLE_NAMES.map((t, i) => [t, results[i]])) as ExportTables;
  tables.patients = mergeConsent(tables.patients, consent.data);
  assertAllowlisted(tables);
  const rowCounts = Object.fromEntries(TABLE_NAMES.map((t) => [t, tables[t].length])) as ExportMeta['rowCounts'];
  const logged = Object.fromEntries(RESEARCH_FILTER_KEYS.map((k) => [k, args[`p_${k}` as keyof typeof args] ?? null]));
  const shown = { ...logged, course: (courseCode.data as string | null) ?? null, delegate: (delegateCode.data as string | null) ?? null };
  const meta: ExportMeta = { exportedAt: new Date().toISOString(), filters: shown, version: String(version.data ?? ''), rowCounts, consent: consentCounts(tables.patients), study };

  const body = format === 'xlsx' ? await buildXlsx(tables, meta) : buildZip(tables, meta);

  const { error } = await supabase.rpc('log_research_export', { p_format: format, p_filters: { ...logged, study: studyId }, p_row_counts: rowCounts });
  if (error) return new NextResponse('Could not record the export', { status: 500 });

  return new NextResponse(body as BodyInit, {
    headers: {
      'Content-Type': format === 'xlsx' ? XLSX : 'application/zip',
      'Content-Disposition': `attachment; filename="${exportFileName(format, todayIso())}"`,
      'Cache-Control': 'no-store',
    },
  });
}

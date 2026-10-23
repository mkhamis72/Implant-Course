import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { todayIso } from '@/lib/dates';
import { RESEARCH_FILTER_KEYS, rpcArgs, type ResearchFilters } from '@/lib/research/view';
import { TABLE_NAMES, assertAllowlisted, type ExportTables } from '@/lib/research/export/dictionary';
import type { ExportMeta } from '@/lib/research/export/assemble';
import { exportFileName } from '@/lib/research/export/assemble';
import { DICTIONARY } from '@/lib/research/export/dictionary';
import { fetchAll } from '@/lib/research/export/fetch-all';
import { buildXlsx } from '@/lib/research/export/xlsx';
import { buildZip } from '@/lib/research/export/zip';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.active || !canView(profile, 'research')) return new NextResponse('Not allowed', { status: 403 });
  // The readers are security invoker over patient tables: without Patients view the file would be silently empty.
  if (!canView(profile, 'patients')) return new NextResponse('Research export needs View on Patients', { status: 403 });

  const params = new URL(req.url).searchParams;
  const format = params.get('format');
  if (format !== 'xlsx' && format !== 'csv') return new NextResponse('Unknown format', { status: 400 });

  const filters = Object.fromEntries(RESEARCH_FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as ResearchFilters;
  const args = rpcArgs(filters);
  const supabase = await createClient();

  // The readers insert study codes, so they are volatile: always plain POST calls.
  const [version, ...results] = await Promise.all([
    supabase.rpc('outcomes_version'),
    ...TABLE_NAMES.map((t) => fetchAll(supabase, `research_export_${t}`, args, Object.keys(DICTIONARY[t]))),
  ]);
  const failed = version.error ?? results.find((r) => r.error)?.error;
  if (failed) {
    console.error('Research export failed', failed.message);
    return new NextResponse('Could not build the export', { status: 500 });
  }

  const tables = Object.fromEntries(TABLE_NAMES.map((t, i) => [t, (results[i].data ?? []) as Record<string, unknown>[]])) as ExportTables;
  assertAllowlisted(tables);
  const rowCounts = Object.fromEntries(TABLE_NAMES.map((t) => [t, tables[t].length])) as ExportMeta['rowCounts'];
  const logged = Object.fromEntries(RESEARCH_FILTER_KEYS.map((k) => [k, args[`p_${k}` as keyof typeof args] ?? null]));
  const meta: ExportMeta = { exportedAt: new Date().toISOString(), filters: logged as ExportMeta['filters'], version: String(version.data ?? ''), rowCounts };

  const body = format === 'xlsx' ? await buildXlsx(tables, meta) : buildZip(tables, meta);

  const { error } = await supabase.rpc('log_research_export', { p_format: format, p_filters: logged, p_row_counts: rowCounts });
  if (error) return new NextResponse('Could not record the export', { status: 500 });

  return new NextResponse(body as BodyInit, {
    headers: {
      'Content-Type': format === 'xlsx' ? XLSX : 'application/zip',
      'Content-Disposition': `attachment; filename="${exportFileName(format, todayIso())}"`,
      'Cache-Control': 'no-store',
    },
  });
}

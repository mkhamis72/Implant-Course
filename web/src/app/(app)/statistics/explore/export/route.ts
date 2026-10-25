import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentProfile } from '@/lib/auth/session';
import { canView } from '@/lib/auth/permissions';
import { todayIso } from '@/lib/dates';
import { ALL_COURSES, RESEARCH_FILTER_KEYS, rpcArgs, type ResearchFilters } from '@/lib/research/view';
import { fetchAll } from '@/lib/research/export/fetch-all';
import { exploreCsv, type ImplantCodes } from '@/lib/analysis/export-csv';
import { applyFilters } from '@/lib/analysis/filters';
import { observe } from '@/lib/analysis/observations';
import { runAnalysis } from '@/lib/analysis/run';
import { windowLabel } from '@/lib/analysis/timepoints';
import { parseExplore } from '@/lib/analysis/url';
import { variable } from '@/lib/analysis/variables';
import { loadExplore } from '../data';

const EXPLORE_KEYS = (k: string) => ['f', 'o', 'w', 'v'].includes(k) || k.startsWith('x_');
const failed = (message: string) => {
  console.error('Explore export failed', message);
  return new NextResponse('Could not build the export', { status: 500 });
};

/** The rows behind an Explore analysis as a pseudonymised CSV (study codes only), logged like the research export. */
export async function GET(req: NextRequest) {
  const profile = await getCurrentProfile();
  if (!profile?.active || profile.mfa_setup_required || !canView(profile, 'research')) return new NextResponse('Not allowed', { status: 403 });
  if (!canView(profile, 'patients')) return new NextResponse('Research export needs View on Patients', { status: 403 });

  const params = new URL(req.url).searchParams;
  const raw = Object.fromEntries(params.entries());
  const state = parseExplore(raw);
  const outcome = variable(state.config.outcome);
  if (!outcome) return new NextResponse('Choose an outcome', { status: 400 });
  const filters = Object.fromEntries(RESEARCH_FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])) as ResearchFilters;
  if (!filters.course) filters.course = ALL_COURSES;
  const args = rpcArgs(filters);
  const supabase = await createClient();

  // Store the study codes first (one ordered insert), then only read them.
  const assigned = await supabase.rpc('assign_research_codes', args);
  if (assigned.error) return failed(assigned.error.message);
  type CodeRow = { site_id: string; implant_code: string | null; patient_code: string | null; delegate_code: string | null;
    supervisor_code: string | null; course_code: string | null };
  const codeRows = await fetchAll<CodeRow>(supabase, 'analysis_codes', args, ['site_id']);
  if (codeRows.error) return failed(codeRows.error.message);
  const codes = new Map<string, ImplantCodes>(codeRows.data.filter((r) => r.implant_code && r.patient_code).map((r) => [r.site_id, {
    implant: r.implant_code!, patient: r.patient_code!, delegate: r.delegate_code, supervisor: r.supervisor_code, course: r.course_code,
  }]));

  let loaded;
  try {
    loaded = await loadExplore(filters);
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }
  const today = todayIso();
  const result = runAnalysis(loaded.data, state.config, today, loaded.labels);
  const timed = outcome.source !== 'implant' && state.config.window !== 'all' && outcome.measure;
  const days = new Map<string, number>();
  if (timed && state.config.window !== 'all') {
    const rows = applyFilters(loaded.data.implants, state.config.filters);
    for (const [site, o] of observe({ ...loaded.data, implants: rows }, outcome.measure!, state.config.window, today).values) days.set(site, o.days);
  }
  // People and courses as the factor are written as study codes (never names), as in the research export.
  const factor = state.config.factor ? variable(state.config.factor) : undefined;
  const groupCode = factor && (factor.key === 'delegate' || factor.key === 'supervisor' || factor.key === 'course') ? factor.key : undefined;
  const notAssessed = new Set(factor ? loaded.data.implants.filter((r) => factor.get(r) === null).map((r) => r.site_id) : []);
  const survival = outcome.kind === 'survival';
  const events = survival ? new Map(loaded.data.implants.map((r) => [r.site_id, r.event])) : undefined;
  const csv = exploreCsv(result, codes, {
    unit: survival ? 'months' : outcome.unit,
    groupCode,
    notAssessed,
    events,
    timepoint: timed && state.config.window !== 'all' ? windowLabel(state.config.window) : '',
    days,
  });

  const explore = Object.fromEntries(Object.entries(raw).filter(([k]) => EXPLORE_KEYS(k)));
  const log = await supabase.rpc('log_research_export', {
    p_format: 'csv', p_filters: { ...filters, explore }, p_row_counts: { points: result.points.length },
  });
  if (log.error) return failed(log.error.message);

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="explore-${outcome.key}-${today}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

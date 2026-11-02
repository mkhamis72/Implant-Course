import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { currentTenant } from '@/lib/tenant/current';
import { requirePermission } from '@/lib/auth/session';
import { canEdit, reportAccessNote } from '@/lib/auth/permissions';
import { formatDate } from '@/lib/format';
import { productLabel } from '@/lib/inventory/labels';
import { OUTCOME_LABELS, SITE_STATE_LABELS, TECHNIQUE_LABELS, type FollowupOutcome, type SiteState } from '@/lib/inventory/types';
import type { ReportRow } from '@/lib/schedule/types';
import { myRestorationStatus, type MyRestorationRow } from '@/lib/delegate-portal/report';
import { restorationStageLabel, restorationTypeLabel } from '@/lib/reports/course-report';
import { describeTeeth } from '@/lib/restorations/restorations';
import { DelegateForm, type DelegateRow } from '../delegate-form';
import { CreateLogin } from './create-login';
import { DeleteDelegate } from './delete-delegate';
import { ResetPassword } from '../../admin/users/reset-password';
import { emailEnabled } from '@/lib/flags';
import { updateDelegate } from '../actions';

function implantLabel(r: ReportRow): string {
  if (!r.type) return '—';
  return productLabel({
    ...r,
    type: r.type,
    brand: r.brand ?? '',
    system: r.system ?? '',
    platform: r.platform ?? '',
    description: r.description ?? '',
  });
}

export default async function DelegatePage({ params }: { params: Promise<{ id: string }> }) {
  const profile = await requirePermission('delegates');
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const supabase = await createClient();
  const [{ data }, { data: reportData }, { data: restoData }] = await Promise.all([
    supabase.from('delegates').select('id, full_name, phone, email, licence_no, notes, active').eq('id', id).maybeSingle(),
    supabase.rpc('delegate_report', { p_delegate: id }),
    supabase.rpc('delegate_restorations', { p_delegate: id }),
  ]);
  if (!data) notFound();
  const delegate = data as DelegateRow;
  const isAdmin = profile.role === 'admin';
  const { companyId } = await currentTenant();
  const { data: member } = isAdmin
    ? await supabase
      .from('company_members')
      .select('user_id, active, profile:profiles(email)')
      .eq('company_id', companyId)
      .eq('delegate_id', id)
      .maybeSingle()
    : { data: null };
  const loginRow = member as unknown as { user_id: string; active: boolean; profile: { email: string } | null } | null;
  const login = loginRow && { user_id: loginRow.user_id, active: loginRow.active, email: loginRow.profile?.email ?? '' };
  const report = (reportData ?? []) as ReportRow[];
  const restorations = (restoData ?? []) as MyRestorationRow[];

  return (
    <div className="space-y-6">
      <h1>{delegate.full_name}</h1>
      <fieldset disabled={!canEdit(profile, 'delegates')} className="min-w-0">
        <DelegateForm action={updateDelegate} delegate={delegate} />
      </fieldset>
      {canEdit(profile, 'delegates') && <DeleteDelegate id={delegate.id} name={delegate.full_name} />}
      {isAdmin && (
        <section className="card space-y-2">
          <h2 className="font-semibold">Login</h2>
          {login ? (
            <>
              <p className="text-sm">
                Login {login.email}: {login.active ? 'active' : 'inactive'} ·{' '}
                <Link href="/admin/users" className="text-accent hover:underline">Manage in Admin → Users</Link>
              </p>
              <p className="text-sm text-muted">Lost or never received their password? Reset it to get a new one-time password to hand over.</p>
              <ResetPassword userId={login.user_id} />
            </>
          ) : (
            <CreateLogin delegateId={delegate.id} emailOn={emailEnabled()} />
          )}
        </section>
      )}
      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">Implant record</h2>
          {reportAccessNote(profile) && <p className="basis-full text-sm text-warn">{reportAccessNote(profile)}</p>}
          <a href={`/delegates/${delegate.id}/report.csv`} className="btn-secondary btn" download>
            Download CSV
          </a>
        </div>
        <p data-testid="report-totals" className="text-sm text-ink">
          Placed {report.filter((r) => r.role === 'placing').length} · Assisted{' '}
          {report.filter((r) => r.role === 'assisting').length} · Failed {report.filter((r) => r.state === 'failed').length} · Guided{' '}
          {report.filter((r) => r.technique === 'guided').length} · Free hand {report.filter((r) => r.technique === 'free_hand').length}
        </p>
        {report.length === 0 ? (
          <p className="text-sm text-muted">No implants recorded for this delegate yet.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Patient</th>
                <th>Tooth</th>
                <th>Role</th>
                <th>Implant</th>
                <th>Technique</th>
                <th>Placed</th>
                <th>State</th>
                <th>Last follow-up</th>
              </tr>
            </thead>
            <tbody>
              {report.map((r) => (
                <tr key={`${r.site_id}-${r.role}`} data-testid="report-row">
                  <td data-label="Course">{r.course_name ?? '—'}</td>
                  <td data-label="Patient">
                    <Link href={`/patients/${r.patient_id}?tooth=${r.tooth}`} className="text-accent hover:underline">
                      {r.patient_name}
                    </Link>
                  </td>
                  <td data-label="Tooth">{r.tooth}</td>
                  <td data-label="Role">{r.role === 'placing' ? 'Placed' : 'Assisted'}</td>
                  <td data-label="Implant">{implantLabel(r)}</td>
                  <td data-label="Technique">{r.technique ? TECHNIQUE_LABELS[r.technique] : '—'}</td>
                  <td data-label="Placed">{r.placed_on ? formatDate(r.placed_on) : '—'}</td>
                  <td data-label="State">{SITE_STATE_LABELS[r.state as SiteState] ?? r.state}</td>
                  <td data-label="Last follow-up">{r.last_outcome ? OUTCOME_LABELS[r.last_outcome as FollowupOutcome] : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="card space-y-2">
        <h2 className="font-semibold">Restorations</h2>
        {restorations.length === 0 ? (
          <p className="text-sm text-muted">No restorations recorded for this delegate yet.</p>
        ) : (
          <table className="table" data-testid="restorations-table">
            <thead>
              <tr>
                <th>Course</th>
                <th>Patient</th>
                <th>Teeth</th>
                <th>Stage</th>
                <th>Type</th>
                <th>Fitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {restorations.map((r) => (
                <tr key={r.restoration_id} data-testid="restoration-row">
                  <td data-label="Course">{r.course_name ?? '—'}</td>
                  <td data-label="Patient">{r.patient_name} ({r.file_no})</td>
                  <td data-label="Teeth">{describeTeeth(r.teeth)}</td>
                  <td data-label="Stage">{restorationStageLabel(r.stage)}</td>
                  <td data-label="Type">{restorationTypeLabel(r.type)}</td>
                  <td data-label="Fitted">{formatDate(r.fitted_on)}</td>
                  <td data-label="Status">{myRestorationStatus(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

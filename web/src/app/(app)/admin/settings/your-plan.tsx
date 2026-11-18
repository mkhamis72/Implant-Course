import { MODULES, MODULE_LABELS, type CompanyKind, type Feature } from '@/lib/modules/modules';

function Status({ on }: { on: boolean }) {
  return on ? <span className="badge-ok">Included</span> : <span className="badge-warn">Not in your plan – contact us</span>;
}

/** Read-only list of what the company's plan includes. */
export function YourPlan({ plan, features }: { plan: { kind: CompanyKind; name: string } | null; features: readonly Feature[] }) {
  const rows: { name: string; on: boolean }[] = [{ name: 'Patients, Schedule, Checklists, Dashboard and Admin', on: true }];
  if (plan?.kind === 'course_organizer') rows.push({ name: 'Courses and delegates', on: features.includes('teaching') });
  for (const m of MODULES) rows.push({ name: MODULE_LABELS[m], on: features.includes(m) });
  return (
    <section className="space-y-2" aria-labelledby="plan-heading">
      <h2 id="plan-heading" className="text-lg font-semibold">Your plan</h2>
      {plan && <p className="text-sm text-muted">Plan: {plan.name}</p>}
      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr><th>Part</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td data-label="Part">{r.name}</td>
                <td data-label="Status"><Status on={r.on} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

import { requireConsoleAdmin } from '@/lib/console/session';
import { consoleStore } from '@/lib/console/store';
import { KIND_LABELS, MODULE_LABELS } from '@/lib/modules/modules';
import { PlanForm } from './plan-form';

/** The plans a company can be on: which modules each switches on (spec: modular design). */
export default async function PlansPage() {
  await requireConsoleAdmin();
  const plans = await consoleStore().plans();
  return (
    <div className="space-y-6">
      <div className="page-header">
        <h1>Plans</h1>
      </div>
      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Modules</th>
              <th>Companies</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td data-label="Name">{p.name}</td>
                <td data-label="Type">{KIND_LABELS[p.kind]}</td>
                <td data-label="Modules">{p.modules.map((m) => MODULE_LABELS[m]).join(', ') || '—'}</td>
                <td data-label="Companies">{p.companies}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {plans.map((p) => (
        <section key={p.id} className="card">
          <h2 className="mb-3 text-lg font-semibold">Edit {p.name}</h2>
          <PlanForm plan={p} />
        </section>
      ))}
      <section className="card">
        <h2 className="mb-3 text-lg font-semibold">New plan</h2>
        <PlanForm />
      </section>
    </div>
  );
}

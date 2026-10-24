import { formatPct, type kmEstimate } from '@/lib/research/summary';
import { formatP, THIN_AT_RISK } from '@/lib/research/stats';
import {
  CLUSTER_NOTE, COMPARE_KEYS, COMPARE_LABELS, LOADING_BIAS_NOTE, NO_FAILURES_NOTE, OPERATOR_NOTE, compareGroups,
  groupSummary, thinWarning, unknownDateNote, type CompareKey, type Group,
} from '@/lib/research/groups';
import { RESEARCH_FILTER_KEYS, type DetailRow, type ResearchFilters } from '@/lib/research/view';

type Estimate = ReturnType<typeof kmEstimate>;

const pct = (s: number) => formatPct(s * 100);

export function Warning({ children }: { children: string }) {
  return <p className="text-sm text-warn">{children}</p>;
}

export function Note({ children }: { children: string }) {
  return <p className="text-xs text-muted">{children}</p>;
}

/** "95% CI a–b%", or a dash with why it can't be estimated. */
export function CiText({ e }: { e: Estimate }) {
  if (e.lower !== null && e.upper !== null) return <span>{`95% CI ${(e.lower * 100).toFixed(1)}–${pct(e.upper)}`}</span>;
  return (
    <span>
      95% CI — <span className="text-muted">{e.events === 0 ? NO_FAILURES_NOTE : "This can't be estimated"}</span>
    </span>
  );
}

function EstimateCell({ e }: { e: Estimate }) {
  if (!e.defined) return <span className="text-muted">— (no implant followed this long yet)</span>;
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{pct(e.surv)}</div>
      <div className="text-xs"><CiText e={e} /></div>
      <div className="text-xs text-muted">{`at risk ${e.nRisk}`}</div>
      {e.nRisk < THIN_AT_RISK && <div className="text-xs text-warn">{thinWarning(e.nRisk, e.events)}</div>}
    </div>
  );
}

function GroupTable({ compare, groups, tested }: { compare: CompareKey; groups: Group<DetailRow>[]; tested: boolean }) {
  const label = COMPARE_LABELS[compare];
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th scope="col">{label}</th>
            <th scope="col">Implants</th>
            <th scope="col">Failures</th>
            <th scope="col">Failure date unknown</th>
            <th scope="col">Survival at 1 year</th>
            <th scope="col">Survival at 2 years</th>
            <th scope="col">ICOI I + II</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const s = groupSummary(g.rows);
            return (
              <tr key={g.label}>
                <td data-label={label}>
                  <div>{g.label}</div>
                  {tested && g.notAssessed && <div className="text-xs text-muted">not in the test</div>}
                  {/* The group's KM population (known failure date) under THIN_AT_RISK at the start: thin, which also covers THIN_GROUP. */}
                  {s.y1.n < THIN_AT_RISK && <div className="text-xs text-warn">{thinWarning(s.y1.n, s.failures)}</div>}
                </td>
                <td data-label="Implants">{s.implants}</td>
                <td data-label="Failures">{s.failures}</td>
                <td data-label="Failure date unknown">{s.unknownDate}</td>
                <td data-label="Survival at 1 year"><EstimateCell e={s.y1} /></td>
                <td data-label="Survival at 2 years"><EstimateCell e={s.y2} /></td>
                <td data-label="ICOI I + II">{`${s.icoiGood} (${formatPct(s.icoiPct)})`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LogRank({ groups }: { groups: Group<DetailRow>[] }) {
  const t = compareGroups(groups);
  return (
    <div className="space-y-1">
      {t.status === 'ok' ? (
        <p>
          {`Log-rank test on ${t.n} implants, ${t.events} failure${t.events === 1 ? '' : 's'}: `}
          <strong>{formatP(t.p)}</strong>
          <span className="text-muted">{` (χ² = ${t.chisq!.toFixed(2)}, df = ${t.df})`}</span>
        </p>
      ) : (
        <p>
          Log-rank test: <strong>—</strong>{' '}
          <span className="text-muted">
            {t.status === 'no_failures' ? NO_FAILURES_NOTE : t.status === 'one_group' ? 'Needs at least two groups to compare' : "This can't be estimated"}
          </span>
        </p>
      )}
      {groups.some((g) => g.notAssessed) && (
        <Note>{`${groups.find((g) => g.notAssessed)!.label} is shown but not included in the test.`}</Note>
      )}
      {t.unknownDate > 0 && <Note>{unknownDateNote(t.unknownDate)}</Note>}
      {t.status === 'ok' && t.thin && <Warning>{thinWarning(t.n, t.events)}</Warning>}
    </div>
  );
}

/** "Compare by": a GET form (the filters ride along as hidden fields), then the group table and the test. */
export function ComparePanel({ compare, groups, filters }: {
  compare: CompareKey | null;
  groups: Group<DetailRow>[];
  filters: ResearchFilters;
}) {
  return (
    <section aria-label="Compare groups" className="card space-y-3">
      <h2>Compare groups</h2>
      <form className="flex flex-wrap items-end gap-3" aria-label="Compare by">
        {RESEARCH_FILTER_KEYS.filter((k) => filters[k]).map((k) => <input key={k} type="hidden" name={k} value={filters[k]} />)}
        <label className="block">
          <span className="label">Compare by</span>
          <select key={compare ?? ''} className="input" name="compare" defaultValue={compare ?? ''}>
            <option value="">No comparison</option>
            {COMPARE_KEYS.map((k) => <option key={k} value={k}>{COMPARE_LABELS[k]}</option>)}
          </select>
        </label>
        <button className="btn-secondary btn">Compare</button>
      </form>
      {compare && (groups.length === 0 ? (
        <p className="text-muted">No implants to compare.</p>
      ) : (
        <>
          <GroupTable compare={compare} groups={groups} tested={compare !== 'loading'} />
          {compare === 'loading' ? <Warning>{LOADING_BIAS_NOTE}</Warning> : <LogRank groups={groups} />}
          <Note>{CLUSTER_NOTE}</Note>
          <Note>{OPERATOR_NOTE}</Note>
        </>
      ))}
    </section>
  );
}

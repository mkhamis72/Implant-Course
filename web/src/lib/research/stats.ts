// Survival statistics for the Research page, matching R's survival package:
// survfit(conf.type = "log-log") for Kaplan–Meier and survdiff for the log-rank test.
// Time is in whatever unit the caller passes (the page uses months).

export type SurvivalRow = { months: number; event: boolean }

export type KmFit = {
  times: number[]
  surv: number[]
  lower: (number | null)[]
  upper: (number | null)[]
  nRisk: number[]
  nEvent: number[]
}

const Z95 = 1.959963984540054 // qnorm(0.975)

export const THIN_AT_RISK = 30
export const THIN_EVENTS = 10
export const THIN_GROUP = 5

// Product-limit estimate at every distinct time (events and censorings, like survfit).
// At a tied time, the events are counted before the censorings: everyone with that time is at risk.
// CI: Greenwood variance on the log-log scale; null where S is 1 or 0 (cannot be estimated).
// Deliberate difference from R: where S = 1, survfit reports a 1–1 interval; this returns null.
// Rows whose time is not a finite number are skipped.
export function kmFit(rows: SurvivalRow[]): KmFit {
  const sorted = finiteRows(rows).sort((a, b) => a.months - b.months)
  const fit: KmFit = { times: [], surv: [], lower: [], upper: [], nRisk: [], nEvent: [] }
  let s = 1
  let greenwood = 0
  let i = 0
  while (i < sorted.length) {
    const t = sorted[i].months
    const n = sorted.length - i
    let d = 0
    let j = i
    for (; j < sorted.length && sorted[j].months === t; j++) if (sorted[j].event) d++
    if (d > 0) {
      s *= 1 - d / n
      greenwood = n > d ? greenwood + d / (n * (n - d)) : Infinity
    }
    const ci = logLogCi(s, greenwood)
    fit.times.push(t)
    fit.surv.push(s)
    fit.lower.push(ci?.lower ?? null)
    fit.upper.push(ci?.upper ?? null)
    fit.nRisk.push(n)
    fit.nEvent.push(d)
    i = j
  }
  return fit
}

function logLogCi(s: number, greenwood: number) {
  if (s <= 0 || s >= 1 || !Number.isFinite(greenwood)) return null
  const se = Math.sqrt(greenwood) / Math.abs(Math.log(s))
  return { lower: s ** Math.exp(Z95 * se), upper: s ** Math.exp(-Z95 * se) }
}

// The step function at `months`; nRisk = still in follow-up at that time (time >= months).
export function survivalAtTime(fit: KmFit, months: number) {
  let last = -1
  while (last + 1 < fit.times.length && fit.times[last + 1] <= months) last++
  const firstAtOrAfter = fit.times.findIndex((t) => t >= months)
  return {
    surv: last < 0 ? 1 : fit.surv[last],
    lower: last < 0 ? null : fit.lower[last],
    upper: last < 0 ? null : fit.upper[last],
    nRisk: firstAtOrAfter < 0 ? 0 : fit.nRisk[firstAtOrAfter],
  }
}

// Log-rank test as R survdiff (rho = 0): chisq = (O - E)' V^- (O - E) over the groups with expected > 0,
// on rank(V) degrees of freedom (= groups with expected > 0, minus 1, whenever V is not zero).
// Empty groups and rows with a non-finite time are ignored. p is null when there are no events, fewer
// than two groups to compare, or no variance at all (everyone at risk failed together at every event),
// where R's solve() would fail.
export function logRank(groups: SurvivalRow[][]): { chisq: number; df: number; p: number | null } {
  const present = groups.map(finiteRows).filter((g) => g.length > 0)
  const k = present.length
  const eventTimes = [...new Set(present.flat().filter((r) => r.event).map((r) => r.months))].sort((a, b) => a - b)
  if (eventTimes.length === 0 || k < 2) return { chisq: 0, df: Math.max(k - 1, 0), p: null }

  const observed = new Array<number>(k).fill(0)
  const expected = new Array<number>(k).fill(0)
  const v = Array.from({ length: k }, () => new Array<number>(k).fill(0))
  for (const t of eventTimes) {
    const atRisk = present.map((g) => g.filter((r) => r.months >= t).length)
    const deaths = present.map((g) => g.filter((r) => r.event && r.months === t).length)
    const n = atRisk.reduce((a, b) => a + b, 0)
    const d = deaths.reduce((a, b) => a + b, 0)
    const spread = n > 1 ? (d * (n - d)) / (n - 1) : 0
    for (let a = 0; a < k; a++) {
      observed[a] += deaths[a]
      expected[a] += (d * atRisk[a]) / n
      for (let b = 0; b < k; b++) {
        v[a][b] += spread * (atRisk[a] / n) * ((a === b ? 1 : 0) - atRisk[b] / n)
      }
    }
  }

  // Groups nobody in which was at risk at any event contribute nothing (R: df counts expected > 0).
  const kept = expected.map((e, a) => (e > 0 ? a : -1)).filter((a) => a >= 0)
  if (kept.length < 2) return { chisq: 0, df: 0, p: null }
  const diff = kept.map((a) => observed[a] - expected[a])
  const { chisq, rank } = quadraticFormGeneralized(
    kept.map((a) => kept.map((b) => v[a][b])),
    diff,
  )
  if (rank === 0 || !Number.isFinite(chisq)) return { chisq: 0, df: 0, p: null }
  return { chisq, df: rank, p: chiSquareP(chisq, rank) }
}

// x' V^- x for a symmetric positive semi-definite V, via an LDL' decomposition that drops
// pivots too small to trust (like R's cholesky2 / chsolve2 used for score tests). Returns rank(V).
function quadraticFormGeneralized(v: number[][], x: number[]): { chisq: number; rank: number } {
  const n = x.length
  const scale = Math.max(...v.map((row, i) => Math.abs(row[i])))
  const tol = scale * Number.EPSILON ** 0.75
  const l = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const d = new Array<number>(n).fill(0)
  for (let i = 0; i < n; i++) {
    let di = v[i][i]
    for (let m = 0; m < i; m++) di -= l[i][m] ** 2 * d[m]
    if (!(di > tol)) continue // dropped dimension: d[i] = 0, column i of L stays 0
    d[i] = di
    for (let j = i + 1; j < n; j++) {
      let s = v[j][i]
      for (let m = 0; m < i; m++) s -= l[j][m] * l[i][m] * d[m]
      l[j][i] = s / di
    }
  }
  // forward solve L y = x (unit lower triangular), then chisq = sum y_i^2 / d_i over kept pivots
  const y = new Array<number>(n).fill(0)
  let chisq = 0
  let rank = 0
  for (let i = 0; i < n; i++) {
    let s = x[i]
    for (let m = 0; m < i; m++) s -= l[i][m] * y[m]
    y[i] = s
    if (d[i] > 0) {
      chisq += (s * s) / d[i]
      rank++
    }
  }
  return { chisq, rank }
}

function finiteRows(rows: SurvivalRow[]): SurvivalRow[] {
  return rows.filter((r) => Number.isFinite(r.months))
}

// Upper tail of the chi-square distribution: Q(df / 2, chisq / 2), the regularized upper incomplete gamma.
// Throws on a NaN chi-square or a df that is not positive, rather than hiding it as p = 1.
export function chiSquareP(chisq: number, df: number): number {
  if (Number.isNaN(chisq)) throw new RangeError('chiSquareP: chi-square is NaN')
  if (!(df > 0)) throw new RangeError(`chiSquareP: df must be positive (got ${df})`)
  if (chisq <= 0) return 1
  return upperGammaQ(df / 2, chisq / 2)
}

function upperGammaQ(a: number, x: number): number {
  const lnPrefix = -x + a * Math.log(x) - lnGamma(a)
  if (x < a + 1) {
    // series for P(a, x)
    let sum = 1 / a
    let term = sum
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break
    }
    return Math.max(0, 1 - sum * Math.exp(lnPrefix))
  }
  // continued fraction for Q(a, x) (modified Lentz)
  const tiny = 1e-300
  let b = x + 1 - a
  let c = 1 / tiny
  let d = 1 / b
  let h = d
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a)
    b += 2
    d = an * d + b
    if (Math.abs(d) < tiny) d = tiny
    c = b + an / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-15) break
  }
  return Math.exp(lnPrefix) * h
}

// Lanczos approximation (g = 7, n = 9).
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
]
function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z)
  const zz = z - 1
  let x = LANCZOS[0]
  for (let i = 1; i < 9; i++) x += LANCZOS[i] / (zz + i)
  const t = zz + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x)
}

// Owner principle: always show the numbers, warn when thin.
// Thin = fewer than 30 at risk, fewer than 10 failures, or (when given) a group with fewer than 5 implants.
export function thinData(n: number, events: number, smallestGroup?: number): boolean {
  return n < THIN_AT_RISK || events < THIN_EVENTS || (smallestGroup !== undefined && smallestGroup < THIN_GROUP)
}

export function formatP(p: number | null): string {
  if (p === null) return '—'
  return p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`
}

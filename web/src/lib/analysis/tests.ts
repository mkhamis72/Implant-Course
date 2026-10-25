// Basic statistics for Statistics → Explore, matching base R (t.test, wilcox.test, kruskal.test, chisq.test,
// fisher.test, cor.test, lm). Reference values: tests.fixture.json. Every function returns null instead of NaN
// when the value is undefined (too few values, no spread).

import { chiSquareP, lnGamma } from '@/lib/research/stats'

export type Descriptives = {
  n: number
  mean: number
  sd: number | null
  median: number
  q1: number
  q3: number
  min: number
  max: number
}

const Z95 = 1.959963984540054 // qnorm(0.975)

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
const mean = (xs: number[]) => sum(xs) / xs.length
function variance(xs: number[]): number {
  const m = mean(xs)
  return sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1)
}

// R's default (type 7) quantile of sorted values.
function quantile(sorted: number[], p: number): number {
  const h = (sorted.length - 1) * p
  const lo = Math.floor(h)
  return sorted[lo] + (h - lo) * ((sorted[Math.min(lo + 1, sorted.length - 1)] ?? sorted[lo]) - sorted[lo])
}

export function describe(xs: number[]): Descriptives | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  return {
    n: xs.length,
    mean: mean(xs),
    sd: xs.length < 2 ? null : Math.sqrt(variance(xs)),
    median: quantile(sorted, 0.5),
    q1: quantile(sorted, 0.25),
    q3: quantile(sorted, 0.75),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  }
}

// Regularized incomplete beta I_x(a, b): continued fraction (modified Lentz), with the symmetry relation.
function incompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lnFront = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  if (x > (a + 1) / (a + b + 2)) return 1 - incompleteBeta(1 - x, b, a)
  const tiny = 1e-300
  let c = 1
  let d = 1 - ((a + b) * x) / (a + 1)
  if (Math.abs(d) < tiny) d = tiny
  d = 1 / d
  let h = d
  for (let m = 1; m < 1000; m++) {
    const m2 = 2 * m
    let num = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2))
    d = 1 + num * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + num / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    h *= d * c
    num = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1))
    d = 1 + num * d
    if (Math.abs(d) < tiny) d = tiny
    c = 1 + num / c
    if (Math.abs(c) < tiny) c = tiny
    d = 1 / d
    const delta = d * c
    h *= delta
    if (Math.abs(delta - 1) < 1e-15) break
  }
  return (Math.exp(lnFront) * h) / a
}

/** P(T ≤ t) for Student's t with df degrees of freedom (R pt). */
export function tCdf(t: number, df: number): number {
  const tail = 0.5 * incompleteBeta(df / (df + t * t), df / 2, 0.5)
  return t > 0 ? 1 - tail : tail
}

const twoSidedT = (t: number, df: number) => Math.min(1, 2 * tCdf(-Math.abs(t), df))
// Two-sided normal p-value: P(|Z| > |z|) = P(chi-square(1) > z²).
const twoSidedZ = (z: number) => chiSquareP(z * z, 1)

// qt(p, df) for p > 0.5, by bisection.
function tQuantile(p: number, df: number): number {
  let lo = 0
  let hi = 1000
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (tCdf(mid, df) < p) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** Welch two-sample comparison; diff = mean(b) − mean(a), with its 95% CI (R t.test(b, a)). */
export function welch(a: number[], b: number[]): { diff: number; lo: number; hi: number; t: number; df: number; p: number } | null {
  if (a.length < 2 || b.length < 2) return null
  const va = variance(a) / a.length
  const vb = variance(b) / b.length
  if (va + vb === 0) return null
  const diff = mean(b) - mean(a)
  const se = Math.sqrt(va + vb)
  const t = diff / se
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1))
  const q = tQuantile(0.975, df)
  return { diff, lo: diff - q * se, hi: diff + q * se, t, df, p: twoSidedT(t, df) }
}

/** Hedges' g for mean(b) − mean(a), pooled SD, small-sample corrected. */
export function hedgesG(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null
  const n = a.length + b.length
  const sp = Math.sqrt(((a.length - 1) * variance(a) + (b.length - 1) * variance(b)) / (n - 2))
  if (sp === 0) return null
  return ((mean(b) - mean(a)) / sp) * (1 - 3 / (4 * n - 9))
}

// Average ranks (1-based) and the tie sizes.
function ranks(xs: number[]): { ranks: number[]; ties: number[] } {
  const order = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0])
  const r = new Array<number>(xs.length)
  const ties: number[] = []
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++
    for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2 + 1
    if (j > i) ties.push(j - i + 1)
    i = j + 1
  }
  return { ranks: r, ties }
}

/** Mann–Whitney (Wilcoxon rank-sum) for a vs b: W as R reports it, normal approximation with tie and continuity correction. */
export function mannWhitney(a: number[], b: number[]): { w: number; p: number } | null {
  if (a.length === 0 || b.length === 0) return null
  const n1 = a.length
  const n2 = b.length
  const n = n1 + n2
  const { ranks: r, ties } = ranks([...a, ...b])
  const w = sum(r.slice(0, n1)) - (n1 * (n1 + 1)) / 2
  const sigma = Math.sqrt((n1 * n2 / 12) * (n + 1 - sum(ties.map((t) => t ** 3 - t)) / (n * (n - 1))))
  if (sigma === 0) return null
  const dev = w - (n1 * n2) / 2
  const z = (dev - Math.sign(dev) * 0.5) / sigma
  return { w, p: twoSidedZ(z) }
}

/** Kruskal–Wallis rank test across groups, tie-corrected. */
export function kruskalWallis(groups: number[][]): { h: number; df: number; p: number } | null {
  if (groups.length < 2 || groups.some((g) => g.length === 0)) return null
  const all = groups.flat()
  const n = all.length
  const { ranks: r, ties } = ranks(all)
  let offset = 0
  let s = 0
  for (const g of groups) {
    const rs = sum(r.slice(offset, offset + g.length))
    s += rs ** 2 / g.length
    offset += g.length
  }
  const correction = 1 - sum(ties.map((t) => t ** 3 - t)) / (n ** 3 - n)
  if (correction === 0) return null
  const h = ((12 / (n * (n + 1))) * s - 3 * (n + 1)) / correction
  const df = groups.length - 1
  return { h, df, p: chiSquareP(h, df) }
}

/** Pearson chi-square test of independence (no continuity correction). */
export function chiSquare(table: number[][]): { chisq: number; df: number; p: number; minExpected: number } | null {
  const rows = table.map(sum)
  const cols = table[0].map((_, j) => sum(table.map((row) => row[j])))
  const n = sum(rows)
  if (n === 0 || rows.length < 2 || cols.length < 2 || rows.some((x) => x === 0) || cols.some((x) => x === 0)) return null
  let chisq = 0
  let minExpected = Infinity
  table.forEach((row, i) => row.forEach((o, j) => {
    const e = (rows[i] * cols[j]) / n
    minExpected = Math.min(minExpected, e)
    chisq += (o - e) ** 2 / e
  }))
  const df = (rows.length - 1) * (cols.length - 1)
  return { chisq, df, p: chiSquareP(chisq, df), minExpected }
}

const lnChoose = (n: number, k: number) => lnGamma(n + 1) - lnGamma(k + 1) - lnGamma(n - k + 1)

/** Fisher's exact test, two-sided as R: the sum of tables no more likely than the observed one. */
export function fisher2x2(table: [[number, number], [number, number]]): { p: number } {
  const [[a, b], [c, d]] = table
  const r1 = a + b
  const c1 = a + c
  const n = a + b + c + d
  const prob = (x: number) => Math.exp(lnChoose(c1, x) + lnChoose(n - c1, r1 - x) - lnChoose(n, r1))
  const observed = prob(a)
  let p = 0
  for (let x = Math.max(0, r1 + c1 - n); x <= Math.min(r1, c1); x++) {
    const px = prob(x)
    if (px <= observed * (1 + 1e-7)) p += px
  }
  return { p: Math.min(1, p) }
}

/** k2/n2 − k1/n1 with a Wald 95% interval. */
export function riskDifference(k1: number, n1: number, k2: number, n2: number): { diff: number; lo: number; hi: number } | null {
  if (n1 === 0 || n2 === 0) return null
  const p1 = k1 / n1
  const p2 = k2 / n2
  const se = Math.sqrt((p1 * (1 - p1)) / n1 + (p2 * (1 - p2)) / n2)
  const diff = p2 - p1
  return { diff, lo: diff - Z95 * se, hi: diff + Z95 * se }
}

/** Pearson correlation with its t-test p and (n ≥ 4) Fisher-z 95% CI. */
export function pearson(x: number[], y: number[]): { r: number; lo: number | null; hi: number | null; p: number } | null {
  const n = x.length
  if (n < 3 || y.length !== n) return null
  const mx = mean(x)
  const my = mean(y)
  const sxy = sum(x.map((xi, i) => (xi - mx) * (y[i] - my)))
  const sxx = sum(x.map((xi) => (xi - mx) ** 2))
  const syy = sum(y.map((yi) => (yi - my) ** 2))
  if (sxx === 0 || syy === 0) return null
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)))
  const p = Math.abs(r) === 1 ? 0 : twoSidedT(r * Math.sqrt((n - 2) / (1 - r * r)), n - 2)
  if (n < 4 || Math.abs(r) === 1) return { r, lo: null, hi: null, p }
  const z = Math.atanh(r)
  const se = 1 / Math.sqrt(n - 3)
  return { r, lo: Math.tanh(z - Z95 * se), hi: Math.tanh(z + Z95 * se), p }
}

/** Spearman's rho (Pearson on average ranks); p by the t approximation, null under 10 pairs. */
export function spearman(x: number[], y: number[]): { rho: number; p: number | null } | null {
  const c = pearson(ranks(x).ranks, ranks(y).ranks)
  if (!c) return null
  return { rho: c.r, p: x.length < 10 ? null : c.p }
}

/** Least-squares line y = intercept + slope · x. */
export function ols(x: number[], y: number[]): { intercept: number; slope: number } | null {
  if (x.length < 2 || y.length !== x.length) return null
  const mx = mean(x)
  const my = mean(y)
  const sxx = sum(x.map((xi) => (xi - mx) ** 2))
  if (sxx === 0) return null
  const slope = sum(x.map((xi, i) => (xi - mx) * (y[i] - my))) / sxx
  return { intercept: my - slope * mx, slope }
}

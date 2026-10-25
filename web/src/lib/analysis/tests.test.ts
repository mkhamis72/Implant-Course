import { describe, expect, it } from 'vitest'
import fixture from './tests.fixture.json'
import {
  chiSquare, describe as describeValues, fisher2x2, hedgesG, kruskalWallis, mannWhitney, ols, pearson, riskDifference,
  spearman, tCdf, welch,
} from './tests'

const { g1, g2 } = fixture.sleep
const { mpg, wt } = fixture.mtcars
const e = fixture.expected
const relClose = (actual: number, expected: number, rel = 1e-3) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel)

describe('analysis statistics against R', () => {
  it('describe matches summary() with type-7 quantiles', () => {
    const d = describeValues(g1)!
    expect(d.n).toBe(10)
    expect(d.mean).toBeCloseTo(e.describeG1.mean, 6)
    expect(d.sd!).toBeCloseTo(e.describeG1.sd, 5)
    expect([d.median, d.q1, d.q3, d.min, d.max].map((x) => Number(x.toFixed(6))))
      .toEqual([e.describeG1.median, e.describeG1.q1, e.describeG1.q3, e.describeG1.min, e.describeG1.max])
  })

  it('welch matches t.test(g2, g1)', () => {
    const w = welch(g1, g2)!
    expect(w.diff).toBeCloseTo(e.welch.diff, 6)
    expect(w.t).toBeCloseTo(-e.welch.t, 3)
    expect(w.df).toBeCloseTo(e.welch.df, 3)
    relClose(w.p, e.welch.p)
    expect(w.lo).toBeCloseTo(e.welch.lo, 5)
    expect(w.hi).toBeCloseTo(e.welch.hi, 5)
  })

  it('hedgesG matches the hand-computed value', () => {
    expect(hedgesG(g1, g2)!).toBeCloseTo(e.hedgesG, 3)
  })

  it('mannWhitney matches wilcox.test(g1, g2)', () => {
    const m = mannWhitney(g1, g2)!
    expect(m.w).toBe(e.mannWhitney.w)
    relClose(m.p, e.mannWhitney.p)
  })

  it('kruskalWallis matches kruskal.test', () => {
    const k = kruskalWallis(fixture.hollanderWolfe)!
    expect(k.h).toBeCloseTo(e.kruskal.h, 4)
    expect(k.df).toBe(2)
    expect(k.p).toBeCloseTo(e.kruskal.p, 2)
  })

  it('chiSquare matches chisq.test', () => {
    const c = chiSquare(fixture.chisqTable)!
    expect(c.chisq).toBeCloseTo(e.chiSquare.chisq, 2)
    expect(c.df).toBe(2)
    relClose(c.p, e.chiSquare.p)
  })

  it('fisher2x2 matches fisher.test', () => {
    expect(fisher2x2(fixture.tea as [[number, number], [number, number]]).p).toBeCloseTo(e.fisher.p, 4)
    expect(fisher2x2([[0, 5], [5, 0]]).p).toBeCloseTo(0.007937, 6)
  })

  it('pearson matches cor.test', () => {
    const p = pearson(wt, mpg)!
    expect(p.r).toBeCloseTo(e.pearson.r, 6)
    expect(p.lo!).toBeCloseTo(e.pearson.lo, 6)
    expect(p.hi!).toBeCloseTo(e.pearson.hi, 6)
    relClose(p.p, e.pearson.p)
  })

  it('spearman matches cor.test(method = "spearman")', () => {
    const s = spearman(wt, mpg)!
    expect(s.rho).toBeCloseTo(e.spearman.rho, 6)
    relClose(s.p!, e.spearman.p)
  })

  it('ols matches lm(mpg ~ wt)', () => {
    const o = ols(wt, mpg)!
    expect(o.intercept).toBeCloseTo(e.ols.intercept, 4)
    expect(o.slope).toBeCloseTo(e.ols.slope, 4)
  })

  it('riskDifference is k2/n2 - k1/n1 with a Wald interval', () => {
    const r = riskDifference(10, 100, 30, 100)!
    expect(r.diff).toBeCloseTo(0.2, 10)
    expect(r.lo).toBeCloseTo(0.2 - 1.959964 * Math.sqrt(0.1 * 0.9 / 100 + 0.3 * 0.7 / 100), 5)
    expect(riskDifference(0, 0, 1, 2)).toBeNull()
  })

  it('tCdf is symmetric and matches pt()', () => {
    expect(tCdf(0, 5)).toBeCloseTo(0.5, 12)
    expect(tCdf(2.015048, 5)).toBeCloseTo(0.95, 5) // qt(0.95, 5)
    expect(tCdf(-2.015048, 5)).toBeCloseTo(0.05, 5)
  })

  it('chiSquare applies the Yates correction on a 2 × 2 table, as chisq.test', () => {
    const c = chiSquare([[20, 20], [10, 30]])!
    expect(c.chisq).toBeCloseTo(4.32, 6)
    expect(c.p).toBeCloseTo(0.0377, 3)
  })

  it('mannWhitney is exact for small groups without ties, as wilcox.test', () => {
    expect(mannWhitney([1, 2, 3], [4, 5, 6])).toEqual({ w: 0, p: 0.1 })
    const m = mannWhitney([1.1, 2.2, 3.3, 7.7], [4.4, 5.5, 6.6, 8.8, 9.9])!
    expect(m.w).toBe(3)
    expect(m.p).toBeCloseTo(0.11111, 5) // 2 × P(W ≤ 3) = 2 × 7/126
  })

  it('returns null rather than NaN when a value is undefined', () => {
    expect(describeValues([])).toBeNull()
    expect(describeValues([3])!.sd).toBeNull()
    expect(hedgesG([1, 1, 1], [1, 1, 1])).toBeNull()
    expect(pearson([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull()
    expect(welch([1], [2, 3])).toBeNull()
    expect(welch([1, 1], [2, 2])).toBeNull()
    expect(spearman([1, 2, 3, 4, 5, 6, 7, 8], [2, 1, 4, 3, 6, 5, 8, 7])!.p).toBeNull()
    expect(mannWhitney([], [1, 2])).toBeNull()
    expect(kruskalWallis([[1, 2], []])).toBeNull()
    expect(chiSquare([[0, 0], [0, 0]])).toBeNull()
  })
})

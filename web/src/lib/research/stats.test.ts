import { describe, expect, it } from 'vitest'
import fixture from './stats.fixture.json'
import { chiSquareP, formatP, kmFit, logRank, survivalAtTime, thinData } from './stats'

type Row = { months: number; event: boolean }
const groups = fixture.groups as Record<string, Row[]>
const Z = 1.959963984540054

// Independent step-by-step Greenwood / log-log computation from the published risk table
// (n at risk, events at each event time), without going through kmFit.
function reference(table: { nRisk: number; nEvent: number }[]) {
  let s = 1
  let greenwood = 0
  return table.map(({ nRisk: n, nEvent: d }) => {
    s *= 1 - d / n
    greenwood += d / (n * (n - d))
    const seLogLog = Math.sqrt(greenwood) / Math.abs(Math.log(s))
    return { surv: s, lower: s ** Math.exp(Z * seLogLog), upper: s ** Math.exp(-Z * seLogLog) }
  })
}

describe('kmFit (Freireich 6-MP)', () => {
  const fit = kmFit(groups[fixture.km.group])
  const at = (t: number) => fit.times.indexOf(t)

  it('matches the published survival, risk table and CI', () => {
    for (const r of fixture.km.rows) {
      const i = at(r.time)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(fit.nRisk[i]).toBe(r.nRisk)
      expect(fit.nEvent[i]).toBe(r.nEvent)
      expect(fit.surv[i]).toBeCloseTo(r.surv, fixture.digits.surv)
      if ('lower' in r && 'upper' in r) {
        expect(fit.lower[i]).toBeCloseTo(r.lower as number, fixture.digits.ci)
        expect(fit.upper[i]).toBeCloseTo(r.upper as number, fixture.digits.ci)
      }
    }
  })

  it('matches the Greenwood / log-log formula to 4 decimals at every event time', () => {
    const ref = reference(fixture.km.rows)
    fixture.km.rows.forEach((r, k) => {
      const i = at(r.time)
      expect(fit.surv[i]).toBeCloseTo(ref[k].surv, 4)
      expect(fit.lower[i]).toBeCloseTo(ref[k].lower, 4)
      expect(fit.upper[i]).toBeCloseTo(ref[k].upper, 4)
    })
    // spot values from the reference, written out
    expect(fit.lower[at(23)]).toBeCloseTo(0.1881, 4)
    expect(fit.upper[at(23)]).toBeCloseTo(0.6801, 4)
  })

  it('counts events before censorings at tied times and keeps censor-only times', () => {
    // t = 6: three events and one censoring; t = 9 is censoring only
    expect(fit.nEvent[at(6)]).toBe(3)
    expect(fit.nRisk[at(9)]).toBe(16)
    expect(fit.nEvent[at(9)]).toBe(0)
    expect(fit.surv[at(9)]).toBeCloseTo(fit.surv[at(7)], 10)
    expect(fit.lower[at(9)]).toBeCloseTo(fit.lower[at(7)] as number, 10)
  })

  it('carries the step function in survivalAtTime', () => {
    expect(survivalAtTime(fit, 0)).toEqual({ surv: 1, lower: null, upper: null, nRisk: 21 })
    const mid = survivalAtTime(fit, 12)
    expect(mid.surv).toBeCloseTo(0.7529, 4)
    expect(mid.nRisk).toBe(12) // still in follow-up at 12 = times >= 12
    expect(survivalAtTime(fit, 6).surv).toBeCloseTo(0.8571, 4)
    const end = survivalAtTime(fit, 40)
    expect(end.surv).toBeCloseTo(0.4482, 4)
    expect(end.nRisk).toBe(0)
  })
})

describe('logRank (6-MP vs placebo)', () => {
  const data = fixture.logRank.groups.map((g) => groups[g])

  it('matches the published survdiff result', () => {
    const r = logRank(data)
    expect(r.df).toBe(fixture.logRank.df)
    expect(r.chisq).toBeCloseTo(fixture.logRank.chisq, fixture.digits.chisq)
    expect(r.p).not.toBeNull()
    // half a unit in the last published significant digit
    const sig = fixture.digits.pSignificant
    const halfUnit = 0.5 * 10 ** (Math.floor(Math.log10(fixture.logRank.p)) - sig + 1)
    expect(Math.abs((r.p as number) - fixture.logRank.p)).toBeLessThanOrEqual(halfUnit * (1 + 1e-9))
  })

  it('matches the two-group closed form (O - E)^2 / V to 4 decimals', () => {
    const all = [...data[0].map((r) => ({ ...r, g: 0 })), ...data[1].map((r) => ({ ...r, g: 1 }))]
    const times = [...new Set(all.filter((r) => r.event).map((r) => r.months))]
    let o = 0
    let e = 0
    let v = 0
    for (const t of times) {
      const risk = all.filter((r) => r.months >= t)
      const n = risk.length
      const n0 = risk.filter((r) => r.g === 0).length
      const d = all.filter((r) => r.event && r.months === t).length
      o += all.filter((r) => r.event && r.months === t && r.g === 0).length
      e += (d * n0) / n
      if (n > 1) v += (d * (n0 / n) * (1 - n0 / n) * (n - d)) / (n - 1)
    }
    const expected = (o - e) ** 2 / v
    expect(logRank(data).chisq).toBeCloseTo(expected, 4)
    expect(expected).toBeCloseTo(16.7929, 4)
  })

  it('ignores empty groups and groups with nobody at risk at any event', () => {
    const early: Row[] = [{ months: 0.5, event: false }]
    const r = logRank([data[0], [], data[1], early])
    expect(r.df).toBe(1)
    expect(r.chisq).toBeCloseTo(logRank(data).chisq, 10)
  })

  it('handles three groups with k - 1 degrees of freedom', () => {
    const r = logRank([groups.mp6, groups.placebo, groups.mp6.slice(0, 10)])
    expect(r.df).toBe(2)
    expect(r.p).toBeCloseTo(chiSquareP(r.chisq, 2), 12)
  })

  // Small three-group example: O, E and V built independently, chisq = d' V^-1 d on groups A and B
  // with an explicit 2 x 2 inverse (dropping C).
  const A: Row[] = [
    { months: 1, event: true },
    { months: 3, event: true },
    { months: 6, event: false },
  ]
  const B: Row[] = [
    { months: 2, event: true },
    { months: 4, event: false },
    { months: 5, event: true },
  ]
  const C: Row[] = [
    { months: 1, event: false },
    { months: 3, event: true },
    { months: 5, event: true },
    { months: 7, event: false },
  ]

  it('matches a hand-built three-group chi-square', () => {
    const gs = [A, B, C]
    const times = [...new Set(gs.flat().filter((r) => r.event).map((r) => r.months))]
    const oe = [0, 0]
    const v = [
      [0, 0],
      [0, 0],
    ]
    for (const t of times) {
      const n = gs.map((g) => g.filter((r) => r.months >= t).length)
      const d = gs.map((g) => g.filter((r) => r.event && r.months === t).length)
      const N = n[0] + n[1] + n[2]
      const D = d[0] + d[1] + d[2]
      const f = N > 1 ? (D * (N - D)) / (N - 1) / N ** 2 : 0
      oe[0] += d[0] - (D * n[0]) / N
      oe[1] += d[1] - (D * n[1]) / N
      v[0][0] += f * n[0] * (N - n[0])
      v[1][1] += f * n[1] * (N - n[1])
      v[0][1] -= f * n[0] * n[1]
    }
    v[1][0] = v[0][1]
    const det = v[0][0] * v[1][1] - v[0][1] * v[1][0]
    const expected = (oe[0] ** 2 * v[1][1] - 2 * oe[0] * oe[1] * v[0][1] + oe[1] ** 2 * v[0][0]) / det
    const r = logRank(gs)
    expect(r.df).toBe(2)
    expect(r.chisq).toBeCloseTo(expected, 10)
  })

  it('gives the same result whatever the group order', () => {
    const base = logRank([A, B, C])
    for (const order of [
      [B, C, A],
      [C, A, B],
      [C, B, A],
    ]) {
      const r = logRank(order)
      expect(r.df).toBe(base.df)
      expect(r.chisq).toBeCloseTo(base.chisq, 10)
    }
  })

  it('gives no p-value when the variance is zero (everyone at risk fails together)', () => {
    const r = logRank([[{ months: 2, event: true }], [{ months: 2, event: true }]])
    expect(r).toEqual({ chisq: 0, df: 0, p: null })
    const r3 = logRank([
      [{ months: 2, event: true }],
      [{ months: 2, event: true }],
      [{ months: 2, event: true }],
    ])
    expect(r3).toEqual({ chisq: 0, df: 0, p: null })
  })

  it('stays finite when the only informative event is the first one', () => {
    // t = 1: three at risk, one fails (variance > 0); t = 2: the two left both fail (n = d, no variance)
    const r = logRank([
      [{ months: 1, event: true }],
      [{ months: 2, event: true }],
      [{ months: 2, event: true }],
    ])
    expect(Number.isFinite(r.chisq)).toBe(true)
    expect(r.df).toBe(2)
    expect(r.p).toBeCloseTo(chiSquareP(r.chisq, 2), 12)
  })
})

describe('zero events', () => {
  const censored: Row[] = [
    { months: 3, event: false },
    { months: 5, event: false },
    { months: 5, event: false },
  ]

  it('keeps survival at 1 with no CI', () => {
    const fit = kmFit(censored)
    expect(fit.times).toEqual([3, 5])
    expect(fit.surv).toEqual([1, 1])
    expect(fit.lower).toEqual([null, null])
    expect(fit.upper).toEqual([null, null])
    expect(survivalAtTime(fit, 12)).toEqual({ surv: 1, lower: null, upper: null, nRisk: 0 })
  })

  it('gives no p-value for the log-rank test', () => {
    expect(logRank([censored, censored])).toEqual({ chisq: 0, df: 1, p: null })
  })

  it('handles no rows at all', () => {
    const fit = kmFit([])
    expect(fit.times).toEqual([])
    expect(survivalAtTime(fit, 12)).toEqual({ surv: 1, lower: null, upper: null, nRisk: 0 })
    expect(logRank([[], []]).p).toBeNull()
  })

  it('gives no CI once survival reaches 0', () => {
    const fit = kmFit([
      { months: 1, event: true },
      { months: 2, event: true },
    ])
    expect(fit.surv[1]).toBe(0)
    expect(fit.lower[1]).toBeNull()
    expect(fit.upper[1]).toBeNull()
  })
})

describe('chiSquareP', () => {
  it('matches known critical values', () => {
    expect(chiSquareP(3.84, 1)).toBeCloseTo(0.05, 3)
    expect(chiSquareP(16.79, 1)).toBeLessThan(0.001)
    expect(chiSquareP(5.991, 2)).toBeCloseTo(Math.exp(-5.991 / 2), 12)
    expect(chiSquareP(18.307, 10)).toBeCloseTo(0.05, 4)
    expect(chiSquareP(0, 3)).toBe(1)
  })
  it('refuses inputs it cannot evaluate instead of returning 1', () => {
    expect(() => chiSquareP(Number.NaN, 1)).toThrow(RangeError)
    expect(() => chiSquareP(3, 0)).toThrow(RangeError)
    expect(() => chiSquareP(3, -1)).toThrow(RangeError)
    expect(() => chiSquareP(3, Number.NaN)).toThrow(RangeError)
  })
})

describe('non-finite times', () => {
  it('skips rows whose time is not a finite number (no hang)', () => {
    const fit = kmFit([
      { months: Number.NaN, event: true },
      { months: 2, event: true },
      { months: Number.POSITIVE_INFINITY, event: false },
      { months: 4, event: false },
    ])
    expect(fit.times).toEqual([2, 4])
    expect(fit.nRisk).toEqual([2, 1])
    expect(fit.surv[0]).toBeCloseTo(0.5, 12)
  })
  it('skips them in the log-rank test too', () => {
    const a: Row[] = [
      { months: 1, event: true },
      { months: 3, event: false },
    ]
    const b: Row[] = [
      { months: 2, event: true },
      { months: 4, event: false },
    ]
    const clean = logRank([a, b])
    const dirty = logRank([[...a, { months: Number.NaN, event: true }], b])
    expect(dirty).toEqual(clean)
  })
})

describe('formatP', () => {
  it('formats', () => {
    expect(formatP(0.0342)).toBe('p = 0.034')
    expect(formatP(0.5)).toBe('p = 0.500')
    expect(formatP(0.001)).toBe('p = 0.001')
    expect(formatP(0.00099)).toBe('p < 0.001')
    expect(formatP(null)).toBe('—')
  })
})

describe('thinData', () => {
  it('flags fewer than 30 at risk or fewer than 10 failures', () => {
    expect(thinData(29, 10)).toBe(true)
    expect(thinData(30, 10)).toBe(false)
    expect(thinData(30, 9)).toBe(true)
  })
  it('flags a group with fewer than 5 implants', () => {
    expect(thinData(30, 10, 4)).toBe(true)
    expect(thinData(30, 10, 5)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { AnalysisData } from './rows'
import { observe, trajectories } from './observations'
import { implantRow, radiographRow, visitRow } from './test-rows'

// Placed 2025-01-10; today is 600 days later, so the 12-month window (271–545) has closed.
const TODAY = '2026-09-02'
const data = (over: Partial<AnalysisData>): AnalysisData => ({ implants: [implantRow()], visits: [], radiographs: [], ...over })
const v = (days: number, over: Parameters<typeof visitRow>[0] = {}) => visitRow({ visit_id: `v${days}`, days_since_placement: days, ...over })
const x = (days: number, over: Parameters<typeof radiographRow>[0] = {}) =>
  radiographRow({ radiograph_id: `x${days}`, days_since_placement: days, ...over })

describe('observe', () => {
  it('takes the observation closest to the window target, the later one on a tie', () => {
    let r = observe(data({ visits: [v(300, { isq: 70 }), v(400, { isq: 74 })] }), 'isq', 'm12', TODAY)
    expect(r.values.get('s1')).toMatchObject({ value: 74, days: 400 })
    r = observe(data({ visits: [v(330, { isq: 70 }), v(400, { isq: 74 })] }), 'isq', 'm12', TODAY)
    expect(r.values.get('s1')!.days).toBe(400)
    r = observe(data({ radiographs: [x(300, { mesial_mm: 1, bone_change_mm: 0.4 }), x(360, { mesial_mm: 1, bone_change_mm: 0.6 })] }),
      'bone_change', 'm12', TODAY)
    expect(r.values.get('s1')!.value).toBe(0.6)
  })

  it('never pools another window: ISQ at day 100 gives nothing at 12 months', () => {
    const r = observe(data({ visits: [v(100, { isq: 70 })] }), 'isq', 'm12', TODAY)
    expect(r.values.size).toBe(0)
    expect(r.missing.get('s1')).toBe('missing')
  })

  it('gives each implant without a value one reason', () => {
    const reason = (d: AnalysisData, measure: Parameters<typeof observe>[1] = 'isq', today = TODAY) =>
      observe(d, measure, 'm12', today).missing.get('s1')
    expect(reason(data({}), 'isq', '2025-04-20')).toBe('pending')
    expect(reason(data({ implants: [implantRow({ event: true, event_on: '2025-07-29' })] }))).toBe('not_applicable')
    expect(reason(data({ visits: [v(365, { attendance: 'did_not_attend' })] }))).toBe('not_attended')
    expect(reason(data({ visits: [v(365)] }))).toBe('not_recorded')
    expect(reason(data({ radiographs: [x(365)] }), 'bone_change')).toBe('not_measured')
    expect(reason(data({ radiographs: [x(365, { mesial_mm: 0.5, distal_mm: 0.5 })] }), 'bone_change')).toBe('not_applicable')
    expect(reason(data({}))).toBe('missing')
  })

  it('puts every implant in exactly one map', () => {
    const d = data({ implants: [implantRow(), implantRow({ site_id: 's2' })], visits: [v(365, { isq: 72 })] })
    const r = observe(d, 'isq', 'm12', TODAY)
    expect([...r.values.keys(), ...r.missing.keys()].sort()).toEqual(['s1', 's2'])
  })

  it('reads ISQ at placement from the implant, and ISQ change against it', () => {
    expect(observe(data({}), 'isq', 'placement', TODAY).values.get('s1')).toMatchObject({ value: 70, days: 0, on: '2025-01-10' })
    expect(observe(data({ visits: [v(180, { isq: 76 })] }), 'isq_change', 'm6', TODAY).values.get('s1')!.value).toBe(6)
    expect(observe(data({ implants: [implantRow({ isq: null })], visits: [v(180, { isq: 76 })] }), 'isq_change', 'm6', TODAY)
      .missing.get('s1')).toBe('not_applicable')
  })

  it('summarizes recession and keeps yes/no findings as text', () => {
    const d = data({ visits: [v(365, { recession_facial_mm: 1, recession_distal_mm: 2.5, bop_any: 'yes' })] })
    expect(observe(d, 'recession_max', 'm12', TODAY).values.get('s1')!.value).toBe(2.5)
    expect(observe(d, 'bop', 'm12', TODAY).values.get('s1')!.value).toBe('yes')
  })

  it('takes a custom window', () => {
    const r = observe(data({ visits: [v(300, { isq: 70 }), v(420, { isq: 75 })] }), 'isq', { from: 400, to: 450 }, TODAY)
    expect(r.values.get('s1')!.value).toBe(75)
  })
})

describe('trajectories', () => {
  it('gives one observation per window per implant', () => {
    const t = trajectories(data({ visits: [v(30, { isq: 68 }), v(40, { isq: 69 }), v(180, { isq: 74 })] }), 'isq', TODAY).get('s1')!
    expect(Object.fromEntries(Object.entries(t).map(([k, o]) => [k, o!.value]))).toEqual({ placement: 70, early: 68, m6: 74 })
  })
})

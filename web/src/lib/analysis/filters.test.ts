import { describe, expect, it } from 'vitest'
import { describeLabelled } from './choices'
import { applyFilters, describeFilters, NONE } from './filters'

describe('describeLabelled', () => {
  const labels = { course: { c1: 'Spring course', c2: 'Autumn course' } }

  it('names courses instead of showing their ids', () => {
    expect(describeLabelled([{ key: 'course', values: ['c1', 'c2'] }], labels)).toEqual(['Course: Spring course, Autumn course'])
  })

  it('keeps Not assessed for no course, and marks a deleted one', () => {
    expect(describeLabelled([{ key: 'course', values: [NONE, 'gone'] }], labels)).toEqual(['Course: Not assessed, Unknown (deleted)'])
  })
})
import { implantRow } from './test-rows'

const rows = [
  implantRow({ site_id: 'a', smoking: 'current', tooth: 36, placement_timing: 'delayed', grafting_performed: 'no', torque_ncm: 35 }),
  implantRow({ site_id: 'b', smoking: 'current', tooth: 16, placement_timing: 'delayed', grafting_performed: 'no', torque_ncm: 50 }),
  implantRow({ site_id: 'c', smoking: 'never', tooth: 46, placement_timing: 'delayed', grafting_performed: 'no', torque_ncm: 20 }),
  implantRow({ site_id: 'd', smoking: null, tooth: 33, placement_timing: 'immediate', grafting_performed: 'yes', torque_ncm: null }),
]
const ids = (r: typeof rows) => r.map((x) => x.site_id)

describe('analysis filters', () => {
  it('ANDs every filter (the spec example)', () => {
    expect(ids(applyFilters(rows, [
      { key: 'smoking', values: ['current'] }, { key: 'jaw', values: ['mandible'] }, { key: 'region', values: ['posterior'] },
      { key: 'placement_timing', values: ['delayed'] }, { key: 'grafting', values: ['no'] },
    ]))).toEqual(['a'])
  })

  it('takes open-ended ranges and the no-answer token', () => {
    expect(ids(applyFilters(rows, [{ key: 'torque', min: 30 }]))).toEqual(['a', 'b'])
    expect(ids(applyFilters(rows, [{ key: 'torque', max: 35 }]))).toEqual(['a', 'c'])
    expect(ids(applyFilters(rows, [{ key: 'smoking', values: [NONE] }]))).toEqual(['d'])
    expect(ids(applyFilters(rows, []))).toEqual(['a', 'b', 'c', 'd'])
  })

  it('refuses an unknown key', () => {
    expect(() => applyFilters(rows, [{ key: 'colour', values: ['red'] }])).toThrow('Unknown filter: colour')
  })

  it('describes filters with labels and units', () => {
    expect(describeFilters([
      { key: 'smoking', values: ['current', NONE] }, { key: 'jaw', values: ['mandible'] }, { key: 'torque', min: 30, max: 45 },
      { key: 'age', min: 40 },
    ])).toEqual(['Smoking: Current, Not assessed', 'Jaw: Mandible', 'Insertion torque 30–45 Ncm', 'Age at placement ≥ 40 years'])
  })
})

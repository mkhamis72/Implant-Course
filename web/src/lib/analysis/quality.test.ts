import { describe, expect, it } from 'vitest'
import { CLUSTER_NOTE, OPERATOR_NOTE } from '@/lib/research/groups'
import { conflictCount, warningsFor, type QualityContext, type QualityInput } from './quality'
import { implantRow, radiographRow, visitRow } from './test-rows'

const group = (label: string, n: number, tested = true) =>
  ({ level: tested ? label.toLowerCase() : null, label, n, patients: n, stats: null, tested })
const input = (over: Partial<QualityInput> = {}): QualityInput => ({
  method: 'numeric_by_group', groups: [group('Never', 40), group('Current', 30)], test: { name: 'Mann–Whitney U', statistic: 'W = 1', p: 0.2 },
  implants: 70, patients: 70, ...over,
})
const ctx = (over: Partial<QualityContext> = {}): QualityContext => ({
  outcomeLabel: 'Marginal bone change', observational: true, eligible: 100, missingCount: 0, spreadDays: [], windowWidth: 274,
  conflicts: 0, factorKey: 'smoking', needsTest: true, unsplittable: null, ...over,
})
const texts = (i: QualityInput, c: QualityContext) => warningsFor(i, c).map((w) => w.text)

describe('data-quality warnings', () => {
  it('flags small groups by name, using the spec wording', () => {
    const w = warningsFor(input({ groups: [group('Never', 40), group('Current', 4), group('Not assessed', 2, false)] }), ctx())
    expect(w.filter((x) => x.kind === 'small_group')).toEqual([
      { kind: 'small_group', group: 'Current', text: '⚠ This group contains only 4 implants. Results should be interpreted cautiously.' },
    ])
  })

  it('flags missing data above 20% of eligible implants', () => {
    expect(texts(input(), ctx({ missingCount: 38 }))).toContain('⚠ 38% of eligible implants have no Marginal bone change at this timepoint.')
    expect(texts(input(), ctx({ missingCount: 20 })).some((t) => t.includes('eligible'))).toBe(false)
    expect(texts(input(), ctx({ missingCount: 38, observational: false })).some((t) => t.includes('eligible'))).toBe(false)
  })

  it('flags unequal groups, spread follow-up, conflicting records and too little data', () => {
    expect(texts(input({ groups: [group('A', 50), group('B', 10)] }), ctx())).toContain('⚠ Group sizes are substantially different.')
    expect(texts(input({ groups: [group('A', 40), group('B', 10)] }), ctx())).not.toContain('⚠ Group sizes are substantially different.')
    expect(texts(input(), ctx({ spreadDays: [280, 300, 500, 540] }))).toContain('⚠ Follow-up timing varies considerably between observations.')
    expect(texts(input(), ctx({ spreadDays: [350, 360, 370, 380] }))).not.toContain('⚠ Follow-up timing varies considerably between observations.')
    expect(texts(input(), ctx({ conflicts: 2 }))).toContain('Some records contain inconsistent dates or clinical values.')
    expect(texts(input({ test: null, groups: [group('A', 40)] }), ctx())).toContain('Not enough valid observations to generate a reliable comparison.')
    expect(texts(input({ test: null }), ctx({ needsTest: false }))).not.toContain('Not enough valid observations to generate a reliable comparison.')
  })

  it('adds the clustering note with a p-value when patients have several implants, and the operator note', () => {
    expect(texts(input({ implants: 70, patients: 50 }), ctx())).toContain(CLUSTER_NOTE)
    expect(texts(input({ implants: 70, patients: 50, test: null }), ctx({ needsTest: false }))).not.toContain(CLUSTER_NOTE)
    expect(texts(input(), ctx({ factorKey: 'delegate' }))).toContain(OPERATOR_NOTE)
    expect(texts(input(), ctx({ unsplittable: 'Insertion torque' })))
      .toContain('Insertion torque has too few distinct values to split into groups.')
  })

  it('counts records dated before the placement', () => {
    expect(conflictCount({
      implants: [implantRow(), implantRow({ site_id: 's2', event_on: '2024-12-01' }), implantRow({ site_id: 's3', final_restoration_on: '2025-01-01' })],
      visits: [visitRow({ days_since_placement: -3 })],
      radiographs: [radiographRow({ days_since_placement: 5 })],
    })).toBe(3)
  })
})

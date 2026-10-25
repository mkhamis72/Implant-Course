import { describe, expect, it } from 'vitest'
import { describe as describeValues } from './tests'
import { CAUSATION, findingsFor, type FindingsInput } from './wording'

const BANNED = /\b(cause[sd]?|best|worst|better|worse)\b/i
const numeric = (label: string, values: number[]) =>
  ({ level: label.toLowerCase(), label, n: values.length, patients: values.length, stats: describeValues(values), tested: true })
const counted = (label: string, yes: number, n: number) =>
  ({ level: label.toLowerCase(), label, n, patients: n, stats: null, counts: { yes, no: n - yes }, tested: true })
const base = (over: Partial<FindingsInput>): FindingsInput => ({
  method: 'numeric_by_group', groups: [], test: null, standardized: null, survival: null, trend: null, included: 0, ...over,
})
const labels = { factor: 'Smoking', outcome: 'Marginal bone change', unit: 'mm' }

describe('plain-language findings', () => {
  it('compares two medians without causal words', () => {
    const f = findingsFor(base({ groups: [numeric('Never', [0.3, 0.4, 0.5]), numeric('Current', [0.8, 0.9, 1.0])] }), labels)
    expect(f[0]).toBe('Marginal bone change was higher in the Current group in this dataset (median 0.9 vs 0.4 mm).')
    expect(f.at(-1)).toBe(CAUSATION)
    expect(CAUSATION).toBe('Association does not necessarily imply causation.')
    const same = findingsFor(base({ groups: [numeric('Never', [0.4, 0.4]), numeric('Current', [0.4, 0.4])] }), labels)
    expect(same[0]).toBe('Marginal bone change was similar in the Never and Current groups in this dataset (median 0.4 vs 0.4 mm).')
  })

  it('writes counts with their denominators', () => {
    const f = findingsFor(base({ method: 'categorical_by_group', groups: [counted('Current', 6, 38), counted('Never', 9, 124)] }),
      { factor: 'Smoking', outcome: 'Biological complication' })
    expect(f[0]).toBe('Biological complication: 6 of 38 implants (Current) vs 9 of 124 implants (Never).')
  })

  it('reports an association only when the rank correlation is clear', () => {
    const l = { factor: 'ISQ at placement', outcome: 'Marginal bone change' }
    const clear = findingsFor(base({ method: 'correlation', included: 40, standardized: { name: 'Spearman ρ', value: -0.42 },
      test: { name: 'Spearman', statistic: 'ρ = −0.42', p: 0.007 } }), l)
    expect(clear[0]).toBe('An association was observed between ISQ at placement and Marginal bone change (Spearman ρ −0.42).')
    const unclear = findingsFor(base({ method: 'correlation', included: 40, standardized: { name: 'Spearman ρ', value: 0.1 },
      test: { name: 'Spearman', statistic: 'ρ = 0.1', p: 0.5 } }), l)
    expect(unclear[0]).toBe('No clear association was observed between ISQ at placement and Marginal bone change (Spearman ρ 0.1).')
  })

  it('leaves out the causation line without a factor, and never uses a banned word', () => {
    const single = findingsFor(base({ method: 'describe', groups: [numeric('All implants', [0.2, 0.4, 0.6])] }), { ...labels, factor: null })
    expect(single).toEqual(['Median Marginal bone change 0.4 mm across 3 implants.'])
    const all = [
      ...single,
      ...findingsFor(base({ groups: [numeric('Never', [0.3]), numeric('Former', [0.5]), numeric('Current', [0.9])] }), labels),
      ...findingsFor(base({ method: 'trend', included: 12 }), labels),
    ]
    for (const line of all) expect(line).not.toMatch(BANNED)
  })
})

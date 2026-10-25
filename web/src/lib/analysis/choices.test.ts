import { describe, expect, it } from 'vitest'
import { levelChoices } from './choices'
import { implantRow } from './test-rows'

describe('levelChoices', () => {
  it('lists the levels present, in analysis order, Not assessed last', () => {
    const rows = [implantRow({ smoking: 'current' }), implantRow({ smoking: null }), implantRow({ smoking: 'never' })]
    expect(levelChoices(rows, 'smoking', {})).toEqual([
      { value: 'never', label: 'Never' }, { value: 'current', label: 'Current' }, { value: '__none', label: 'Not assessed' },
    ])
  })

  it('sorts data-driven levels by label and names unknown people', () => {
    expect(levelChoices([implantRow({ brand: 'Zeta' }), implantRow({ brand: 'Alpha' })], 'brand', {}).map((l) => l.label))
      .toEqual(['Alpha', 'Zeta'])
    const rows = [implantRow({ placing_delegate_id: 'd1' }), implantRow({ placing_delegate_id: 'd2' })]
    expect(levelChoices(rows, 'delegate', { delegate: { d2: 'Amy' } })).toEqual([
      { value: 'd2', label: 'Amy' }, { value: 'd1', label: 'Unknown (deleted)' },
    ])
  })

  it('refuses a continuous variable', () => {
    expect(() => levelChoices([implantRow()], 'torque', {})).toThrow('Not a categorical variable: torque')
  })
})

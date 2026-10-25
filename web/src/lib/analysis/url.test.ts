import { describe, expect, it } from 'vitest'
import { exploreQuery, parseExplore, type ExploreState } from './url'

const toParams = (query: string) => Object.fromEntries(new URLSearchParams(query.slice(1)))

describe('Explore URL state', () => {
  it('round-trips a full analysis', () => {
    const state: ExploreState = {
      config: {
        factor: 'smoking', outcome: 'bone_change', window: 'm12',
        filters: [{ key: 'smoking', values: ['current', '__none'] }, { key: 'torque', min: 30, max: 45 }],
      },
      view: 'strip',
    }
    expect(parseExplore(toParams(exploreQuery(state, {})))).toEqual(state)
    const custom: ExploreState = { config: { factor: null, outcome: 'isq', window: { from: 300, to: 400 }, filters: [{ key: 'age', min: 40 }] }, view: null }
    expect(parseExplore(toParams(exploreQuery(custom, {})))).toEqual(custom)
    const trend: ExploreState = { config: { factor: 'jaw', outcome: 'isq', window: 'all', filters: [] }, view: 'trend' }
    expect(parseExplore(toParams(exploreQuery(trend, {})))).toEqual(trend)
  })

  it('starts empty', () => {
    expect(parseExplore({})).toEqual({ config: { factor: null, outcome: '', window: 'm12', filters: [] }, view: null })
  })

  it('drops bad parts instead of failing', () => {
    const s = parseExplore({ f: 'colour', o: 'nope', w: 'd500-100', v: 'pie', x_colour: 'a', x_torque: 'abc..', x_smoking: 'current' })
    expect(s).toEqual({ config: { factor: null, outcome: '', window: 'm12', filters: [{ key: 'smoking', values: ['current'] }] }, view: null })
    expect(parseExplore({ w: 'x' }).config.window).toBe('m12')
    expect(parseExplore({ w: 'd300-400' }).config.window).toEqual({ from: 300, to: 400 })
    expect(parseExplore({ x_torque: '..50' }).config.filters).toEqual([{ key: 'torque', max: 50 }])
    expect(parseExplore({ x_survival: 'yes' }).config.filters).toEqual([])
    expect(parseExplore({ x_smoking: 'current,purple' }).config.filters).toEqual([{ key: 'smoking', values: ['current'] }])
    expect(parseExplore({ x_smoking: 'purple' }).config.filters).toEqual([])
  })

  it('keeps the SQL filters and leaves out empty parts', () => {
    const q = exploreQuery({ config: { factor: null, outcome: 'failed', window: 'm12', filters: [] }, view: null }, { course: 'all', brand: 'Oxy', system: '' })
    expect(toParams(q)).toEqual({ course: 'all', brand: 'Oxy', o: 'failed', w: 'm12' })
  })
})

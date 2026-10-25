import { describe, expect, it } from 'vitest'
import { parseExplore, type ExploreState } from './url'
import { savedConfigSchema, savedCourse, savedHref, toSavedConfig } from './saved'

const state: ExploreState = {
  config: { factor: 'smoking', outcome: 'bone_change', window: 'm12', filters: [{ key: 'torque', min: 30 }] },
  view: 'strip',
}
const COURSE = '00000000-0000-4000-8000-000000000001'

describe('saved analysis config', () => {
  it('round-trips through the Explore URL', () => {
    const saved = toSavedConfig(state, { course: 'all', brand: '' }, false)
    expect(saved).toEqual({ version: 1, query: { course: 'all', f: 'smoking', o: 'bone_change', w: 'm12', v: 'strip', x_torque: '30..' } })
    expect(parseExplore(saved.query)).toEqual(state)
    expect(toSavedConfig(state, {}, true).query.alt).toBe('1')
  })

  it('accepts the Explore keys and refuses anything else', () => {
    const ok = (query: Record<string, string>, version = 1) => savedConfigSchema.safeParse({ version, query }).success
    expect(ok({ f: 'jaw', x_torque: '30..', course: COURSE, delegate: COURSE, alt: '1' })).toBe(true)
    expect(ok({ colour: 'red' })).toBe(false)
    expect(ok({ f: 'x'.repeat(501) })).toBe(false)
    expect(ok(Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`x_k${i}`, '1'])))).toBe(false)
    expect(ok({ f: 'jaw' }, 2)).toBe(false)
  })

  it('links to Explore with the query encoded, and knows its course', () => {
    expect(savedHref({ version: 1, query: { brand: 'A&B', f: 'jaw' } })).toBe('/statistics/explore?brand=A%26B&f=jaw')
    expect(savedCourse({ version: 1, query: { course: COURSE } })).toBe(COURSE)
    expect(savedCourse({ version: 1, query: { course: 'all' } })).toBeNull()
  })

  it('opens a stale saved query without failing, dropping what no longer exists', () => {
    const stale = parseExplore({ f: 'removed_var', o: 'failed', x_smoking: 'purple', course: COURSE })
    expect(stale.config.factor).toBeNull()
    expect(stale.config.filters).toEqual([])
    expect(stale.config.outcome).toBe('failed')
  })
})

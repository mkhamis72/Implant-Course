import { describe, expect, it } from 'vitest'
import { choose } from './choose'

const BANNED = /\b(cause[sd]?|best|worst|better|worse)\b/i

describe('choose', () => {
  it.each([
    ['categorical', 'continuous', false, 'numeric_by_group', ['box', 'strip', 'table']],
    ['ordinal', 'count', false, 'numeric_by_group', ['box', 'strip', 'table']],
    ['continuous', 'continuous', false, 'correlation', ['scatter', 'table']],
    ['binary', 'binary', false, 'categorical_by_group', ['bar_stacked', 'bar_grouped', 'table']],
    ['categorical', 'ordinal', false, 'categorical_by_group', ['bar_stacked', 'bar_grouped', 'table']],
    ['continuous', 'binary', false, 'numeric_by_group', ['box', 'table']],
    ['categorical', 'survival', false, 'survival', ['km', 'table']],
    ['continuous', 'survival', false, 'survival', ['km', 'table']],
    ['categorical', 'continuous', true, 'trend', ['trend', 'trajectories', 'table']],
    [null, 'continuous', true, 'trend', ['trend', 'trajectories', 'table']],
    [null, 'continuous', false, 'describe', ['summary', 'table']],
    [null, 'binary', false, 'describe', ['summary', 'table']],
    [null, 'survival', false, 'survival', ['km', 'table']],
  ] as const)('%s → %s (over time: %s) is %s', (factor, outcome, longitudinal, method, views) => {
    const c = choose(factor, outcome, longitudinal)
    expect(c.method).toBe(method)
    expect(c.views).toEqual(views)
    expect(c.explain).not.toMatch(BANNED)
    expect(c.explain.length).toBeGreaterThan(20)
  })

  it('explains group comparisons in plain language', () => {
    expect(choose('categorical', 'continuous', false).explain).toContain('compares the distribution of')
  })
})

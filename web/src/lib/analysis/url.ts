// The Explore analysis as URL parameters, so an analysis can be shared, bookmarked and restored. Anything that no
// longer makes sense (a removed variable, a bad window, a level that no longer exists) is dropped, never fatal.
//   f = factor   o = outcome   w = timepoint key | all | d<from>-<to>   v = view
//   x_<key> = comma-separated levels (__none = not assessed) or <min>..<max> (either side optional)

import type { View } from './choose'
import { NONE, type Filter } from './filters'
import type { AnalysisConfig } from './run'
import { TIMEPOINTS, type Window } from './timepoints'
import { variable } from './variables'

export type ExploreState = { config: AnalysisConfig; view: View | null }

const VIEWS: View[] = ['box', 'strip', 'scatter', 'bar_stacked', 'bar_grouped', 'km', 'trend', 'trajectories', 'summary', 'table']
const DEFAULT_WINDOW = 'm12'

function parseWindow(w: string | undefined): Window | 'all' {
  if (w === 'all') return 'all'
  if (TIMEPOINTS.some((t) => t.key === w)) return w as Window
  const m = /^d(\d+)-(\d+)$/.exec(w ?? '')
  if (m && Number(m[1]) <= Number(m[2])) return { from: Number(m[1]), to: Number(m[2]) }
  return DEFAULT_WINDOW
}

const windowParam = (w: Window | 'all') => (typeof w === 'string' ? w : `d${w.from}-${w.to}`)

function parseFilter(key: string, raw: string): Filter | null {
  const v = variable(key)
  if (!v || v.source !== 'implant' || v.kind === 'survival') return null
  if (v.kind === 'continuous' || v.kind === 'count') {
    const m = /^(-?\d+(?:\.\d+)?)?\.\.(-?\d+(?:\.\d+)?)?$/.exec(raw)
    if (!m || (m[1] === undefined && m[2] === undefined)) return null
    return { key, ...(m[1] !== undefined ? { min: Number(m[1]) } : {}), ...(m[2] !== undefined ? { max: Number(m[2]) } : {}) }
  }
  const known = v.levels ? new Set([...v.levels.map((l) => l.value), NONE]) : null
  const values = raw.split(',').filter((x) => x !== '' && (!known || known.has(x)))
  return values.length ? { key, values } : null
}

export function parseExplore(params: Record<string, string | undefined>): ExploreState {
  const factor = params.f && variable(params.f)?.role !== 'outcome' && variable(params.f) ? params.f : null
  const outcome = params.o && variable(params.o)?.role !== 'factor' && variable(params.o) ? params.o : ''
  const filters = Object.entries(params)
    .filter(([k, raw]) => k.startsWith('x_') && raw)
    .map(([k, raw]) => parseFilter(k.slice(2), raw!))
    .filter((f): f is Filter => f !== null)
  const view = VIEWS.includes(params.v as View) ? (params.v as View) : null
  return { config: { factor, outcome, window: parseWindow(params.w), filters }, view }
}

export function exploreQuery(state: ExploreState, base: Record<string, string>): string {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(base)) if (v) q.set(k, v)
  const { factor, outcome, window, filters } = state.config
  if (factor) q.set('f', factor)
  if (outcome) q.set('o', outcome)
  q.set('w', windowParam(window))
  if (state.view) q.set('v', state.view)
  for (const f of filters) {
    q.set(`x_${f.key}`, f.values ? f.values.join(',') : `${f.min ?? ''}..${f.max ?? ''}`)
  }
  return `?${q.toString()}`
}

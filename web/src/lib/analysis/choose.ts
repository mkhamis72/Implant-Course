// Which views and which basic analysis suit a factor/outcome pair, from their kinds alone. The first view is the
// default; the page shows only these. Counts are analysed as numbers, ordinal levels as categories.

import type { Kind } from './variables'

export type View = 'box' | 'strip' | 'scatter' | 'bar_stacked' | 'bar_grouped' | 'km' | 'trend' | 'trajectories' | 'summary' | 'table'
export type Method = 'numeric_by_group' | 'correlation' | 'categorical_by_group' | 'survival' | 'trend' | 'describe'

type Shape = 'numeric' | 'categorical' | 'survival'
const shape = (k: Kind): Shape => (k === 'survival' ? 'survival' : k === 'continuous' || k === 'count' || k === 'longitudinal' ? 'numeric' : 'categorical')

export function choose(factor: Kind | null, outcome: Kind, longitudinal: boolean): { method: Method; views: View[]; explain: string } {
  const o = shape(outcome)
  if (o === 'survival') {
    return {
      method: 'survival', views: ['km', 'table'],
      explain: factor === null
        ? 'Shows the share of implants still in place over time (Kaplan–Meier), counting only the follow-up each implant has had.'
        : factor === 'continuous'
          ? 'Splits implants at the median of the factor and shows the share still in place over time in each half (Kaplan–Meier).'
          : 'Shows the share of implants still in place over time in each group (Kaplan–Meier), with a log-rank comparison.',
    }
  }
  if (longitudinal && o === 'numeric') {
    return {
      method: 'trend', views: ['trend', 'trajectories', 'table'],
      explain: 'Shows how the measurement changes across follow-up windows, using one value per implant in each window.',
    }
  }
  if (factor === null) {
    return { method: 'describe', views: ['summary', 'table'], explain: 'Summarises the outcome across the selected implants.' }
  }
  const f = shape(factor)
  if (f === 'numeric' && o === 'numeric') {
    return {
      method: 'correlation', views: ['scatter', 'table'],
      explain: 'Plots each implant by both measurements and checks whether they tend to rise or fall together (rank correlation).',
    }
  }
  if (f === 'numeric') {
    return {
      method: 'numeric_by_group', views: ['box', 'table'],
      explain: 'Compares the factor between implants with and without the outcome.',
    }
  }
  if (o === 'numeric') {
    return {
      method: 'numeric_by_group', views: ['box', 'strip', 'table'],
      explain: 'This compares the distribution of the outcome between groups, using medians and a rank test.',
    }
  }
  return {
    method: 'categorical_by_group', views: ['bar_stacked', 'bar_grouped', 'table'],
    explain: 'Compares how often each outcome occurs in each group, with counts out of the group size.',
  }
}

// The Explore data download: one row per analysed implant, identified by study codes only (no names, file numbers,
// raw ids or free text). Values are raw, for further analysis.

import { toCsv } from '@/lib/research/export/csv'
import type { AnalysisResult } from './run'

export const EXPLORE_COLUMNS = ['implant_code', 'patient_code', 'group', 'value', 'unit', 'timepoint', 'days_since_placement']

export function exploreCsv(
  result: AnalysisResult,
  codes: Map<string, { implant: string; patient: string }>,
  ctx: { unit?: string; timepoint: string; days: Map<string, number> },
): string {
  const rows = result.points.flatMap((pt) => {
    const code = codes.get(pt.siteId)
    if (!code) return []
    return [{
      implant_code: code.implant, patient_code: code.patient, group: pt.x, value: pt.y, unit: ctx.unit ?? '',
      timepoint: ctx.timepoint, days_since_placement: ctx.days.get(pt.siteId) ?? '',
    }]
  })
  return toCsv(rows, EXPLORE_COLUMNS)
}

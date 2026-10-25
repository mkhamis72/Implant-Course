// The Explore data download: one row per analysed implant, identified by study codes only (no names, file numbers,
// raw ids or free text). People and courses used as the factor are written as their codes too (as in the research
// export). Values are raw, for further analysis; survival rows carry follow-up months and the event.

import { toCsv } from '@/lib/research/export/csv'
import type { AnalysisResult } from './run'

export const EXPLORE_COLUMNS = ['implant_code', 'patient_code', 'group', 'value', 'unit', 'timepoint', 'days_since_placement', 'event']

export type ImplantCodes = { implant: string; patient: string; delegate?: string | null; supervisor?: string | null; course?: string | null }

export function exploreCsv(
  result: AnalysisResult,
  codes: Map<string, ImplantCodes>,
  ctx: {
    unit?: string
    timepoint: string
    days: Map<string, number>
    /** The factor is a person or course: write its study code as the group. */
    groupCode?: 'delegate' | 'supervisor' | 'course'
    /** Implants whose factor was not assessed (their group stays "Not assessed"). */
    notAssessed?: Set<string>
    /** Survival: whether the implant had the event. */
    events?: Map<string, boolean>
  },
): string {
  const rows = result.points.flatMap((pt) => {
    const code = codes.get(pt.siteId)
    if (!code) return []
    const group = ctx.groupCode && !ctx.notAssessed?.has(pt.siteId) ? code[ctx.groupCode] ?? '' : pt.x
    const event = ctx.events?.get(pt.siteId)
    return [{
      implant_code: code.implant, patient_code: code.patient, group, value: pt.y, unit: ctx.unit ?? '',
      timepoint: ctx.timepoint, days_since_placement: ctx.days.get(pt.siteId) ?? '',
      event: event === undefined ? '' : event ? 'yes' : 'no',
    }]
  })
  return toCsv(rows, EXPLORE_COLUMNS)
}

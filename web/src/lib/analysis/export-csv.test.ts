import { describe, expect, it } from 'vitest'
import type { AnalysisResult } from './run'
import { EXPLORE_COLUMNS, exploreCsv } from './export-csv'

const SITE = '00000000-0000-4000-8000-0000000000aa'
const result = (points: AnalysisResult['points']) => ({ points } as AnalysisResult)
const codes = new Map([[SITE, { implant: 'I-ABC234', patient: 'P-XYZ789', delegate: 'D-DEL234', supervisor: 'S-SUP234', course: 'C-COU234' }]])
const lines = (csv: string) => csv.replace(/^﻿/, '').trimEnd().split('\r\n')

describe('exploreCsv', () => {
  it('writes the fixed columns, codes and raw values', () => {
    const csv = exploreCsv(result([{ siteId: SITE, x: 'Current', y: -0.25 }]), codes, { unit: 'mm', timepoint: '12 months', days: new Map([[SITE, 371]]) })
    expect(EXPLORE_COLUMNS).toEqual(['implant_code', 'patient_code', 'group', 'value', 'unit', 'timepoint', 'days_since_placement', 'event'])
    expect(lines(csv)).toEqual(['implant_code,patient_code,group,value,unit,timepoint,days_since_placement,event', 'I-ABC234,P-XYZ789,Current,-0.25,mm,12 months,371,'])
  })

  it('never writes a raw id, and skips a point without a code', () => {
    const other = '00000000-0000-4000-8000-0000000000bb'
    const csv = exploreCsv(result([{ siteId: SITE, x: 'Never', y: 'yes' }, { siteId: other, x: 'F123', y: 1 }]), codes, { timepoint: '', days: new Map() })
    expect(lines(csv)).toHaveLength(2)
    expect(csv).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
  })

  it('writes people and courses as study codes, never their names', () => {
    for (const [key, code] of [['delegate', 'D-DEL234'], ['supervisor', 'S-SUP234'], ['course', 'C-COU234']] as const) {
      const csv = exploreCsv(result([{ siteId: SITE, x: 'Dr Ahmed Example', y: 0.3 }]), codes, { timepoint: '', days: new Map(), groupCode: key })
      expect(csv).not.toContain('Ahmed')
      expect(lines(csv)[1].split(',')[2]).toBe(code)
    }
    const notAssessed = exploreCsv(result([{ siteId: SITE, x: 'Not assessed', y: 0.3 }]), codes, { timepoint: '', days: new Map(), groupCode: 'delegate', notAssessed: new Set([SITE]) })
    expect(lines(notAssessed)[1].split(',')[2]).toBe('Not assessed')
  })

  it('gives survival rows their follow-up in months and the event', () => {
    const csv = exploreCsv(result([{ siteId: SITE, x: 'Never', y: 13.5 }]), codes,
      { unit: 'months', timepoint: '', days: new Map(), events: new Map([[SITE, true]]) })
    expect(lines(csv)[1]).toBe('I-ABC234,P-XYZ789,Never,13.5,months,,,yes')
  })

  it('is just the header when nothing was analysed', () => {
    expect(lines(exploreCsv(result([]), codes, { timepoint: '', days: new Map() }))).toEqual([EXPLORE_COLUMNS.join(',')])
  })
})

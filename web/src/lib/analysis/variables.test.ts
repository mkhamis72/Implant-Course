import { describe, expect, it } from 'vitest'
import { PLACEMENT_TIMING_LABELS } from '@/lib/implants/surgery'
import type { ImplantRow } from './rows'
import { implantRow } from './test-rows'
import { factorChoices, outcomeChoices, sortsByLabel, variable, VARIABLES } from './variables'

describe('variable registry', () => {
  it('has unique keys, and levels for every categorical variable with a fixed list', () => {
    const keys = VARIABLES.map((v) => v.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const v of VARIABLES) {
      if (['categorical', 'binary', 'ordinal'].includes(v.kind)) expect(v.levels?.length || v.dynamicLevels, v.key).toBeTruthy()
    }
  })

  it('offers these factors and outcomes', () => {
    expect(factorChoices().map((v) => v.key).sort()).toEqual([
      'age', 'age_band', 'sex', 'smoking', 'diabetes', 'periodontitis', 'bruxism', 'previous_failure', 'brand', 'system', 'platform',
      'diameter', 'length', 'jaw', 'region', 'tooth', 'technique', 'bone_type', 'torque', 'isq_placement', 'placement_timing',
      'implant_type', 'angulation', 'tilt_direction', 'anchorage', 'case_type',
      'grafting', 'membrane', 'sinus', 'phenotype', 'keratinized', 'flap', 'healing', 'delegate', 'supervisor', 'course',
    ].sort())
    expect(outcomeChoices().map((v) => v.key).sort()).toEqual([
      'survival', 'failed', 'latest_grade', 'biological_complication', 'mechanical_complication', 'prosthetic_problem',
      'final_restoration', 'bone_change', 'bone_mesial', 'bone_distal', 'isq', 'isq_change', 'probing_max', 'bop', 'suppuration',
      'mobility', 'plaque', 'pain', 'recession_facial', 'recession_mesial', 'recession_distal', 'recession_max',
    ].sort())
  })

  it('derives jaw, region, age band and the outcome flags', () => {
    const get = (key: string, over: Partial<ImplantRow> = {}) => variable(key)!.get(implantRow(over))
    expect(get('jaw')).toBe('mandible')
    expect(get('jaw', { tooth: 13 })).toBe('maxilla')
    expect(get('region')).toBe('posterior')
    expect(get('region', { tooth: 13 })).toBe('anterior')
    expect(get('region', { tooth: 43 })).toBe('anterior')
    expect(get('region', { tooth: 44 })).toBe('posterior')
    expect(get('age_band')).toBe('40-49')
    expect(get('age_band', { age_at_placement: 29 })).toBe('<30')
    expect(get('age_band', { age_at_placement: 70 })).toBe('70+')
    expect(get('diameter')).toBe(4.1)
    expect(get('biological_complication', { biological_complications: 2 })).toBe('yes')
    expect(get('biological_complication')).toBe('no')
    expect(get('final_restoration', { final_restoration_on: '2025-06-01' })).toBe('yes')
    expect(get('failed', { event: true })).toBe('yes')
    expect(get('smoking')).toBeNull()
    expect(get('tooth')).toBe('36')
  })

  it('reuses the app labels and orders people by label', () => {
    expect(variable('placement_timing')!.levels).toEqual(
      Object.entries(PLACEMENT_TIMING_LABELS).map(([value, label]) => ({ value, label })))
    expect(variable('smoking')!.levels!.map((l) => l.value)).toEqual(['never', 'former', 'current'])
    expect(['delegate', 'supervisor', 'course'].every((k) => sortsByLabel(variable(k)!))).toBe(true)
    expect(sortsByLabel(variable('smoking')!)).toBe(false)
    expect(variable('bone_change')).toMatchObject({ source: 'radiograph', measure: 'bone_change', kind: 'continuous', unit: 'mm' })
    expect(variable('survival')!.kind).toBe('survival')
  })
})

describe('full-arch factors', () => {
  const get = (key: string, over: Partial<ImplantRow> = {}) => variable(key)!.get(implantRow(over))
  it('reads the rehab columns, null when absent', () => {
    expect(get('implant_type')).toBeNull()
    expect(get('implant_type', { implant_type: 'zygomatic' })).toBe('zygomatic')
    expect(get('angulation', { angulation_deg: 30 })).toBe(30)
    expect(get('tilt_direction', { angulation_direction: 'distal' })).toBe('distal')
    expect(get('anchorage', { anchorage: 'zygoma' })).toBe('zygoma')
    expect(get('case_type', { case_configuration: 'all_on_4' })).toBe('all_on_4')
  })
  it('declares kind, unit and group', () => {
    expect(variable('angulation')).toMatchObject({ kind: 'continuous', unit: '°', group: 'Full arch' })
    expect(variable('implant_type')).toMatchObject({ kind: 'categorical', group: 'Full arch' })
  })
})

describe('teaching off (a clinic)', () => {
  it('offers no course, delegate or supervisor variable', () => {
    const keys = [...factorChoices(false), ...outcomeChoices(false)].map((v) => v.key)
    for (const k of ['course', 'delegate', 'supervisor']) expect(keys).not.toContain(k)
    expect(factorChoices(true).map((v) => v.key)).toEqual(expect.arrayContaining(['course', 'delegate', 'supervisor']))
    expect(factorChoices().map((v) => v.key)).toContain('course')
  })
})

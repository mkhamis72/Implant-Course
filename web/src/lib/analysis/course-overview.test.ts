import { describe, expect, it } from 'vitest'
import { courseExploreHref, courseOverview, metricRows, selectedCourses, type CourseOption, type CourseSummary } from './course-overview'
import { NONE } from './filters'
import { implantRow, radiographRow, visitRow } from './test-rows'
import { parseExplore } from './url'

const today = '2026-01-01'
const c1: CourseOption = { id: 'c1', name: 'Old', start_date: '2025-01-01' }
const c2: CourseOption = { id: 'c2', name: 'New', start_date: '2025-06-01' }
const none = { visits: [], radiographs: [] }

const one = (data: Parameters<typeof courseOverview>[0]): CourseSummary => courseOverview(data, [c1], today)[0]
const window = (s: CourseSummary, key: string) => s.followUp.find((w) => w.key === key)!
const measured = (s: CourseSummary, key: string) => s.measurements.find((m) => m.key === key)!.recorded

describe('courseOverview', () => {
  it('groups by course in the given order, with No course recorded last', () => {
    const s = courseOverview({ ...none, implants: [implantRow({ site_id: 'a', course_id: 'c1' }), implantRow({ site_id: 'b', course_id: null })] }, [c2, c1], today)
    expect(s.map((x) => x.name)).toEqual(['New', 'Old', 'No course recorded'])
    expect(s[2].id).toBe(NONE)
    expect(s[0].startDate).toBe('2025-06-01')
  })

  it('leaves out the No course row when every implant has a course', () => {
    const s = courseOverview({ ...none, implants: [implantRow()] }, [c1], today)
    expect(s.map((x) => x.id)).toEqual(['c1'])
  })

  it('counts implants and distinct patients', () => {
    const s = one({ ...none, implants: [implantRow({ site_id: 'a' }), implantRow({ site_id: 'b' })] })
    expect(s).toMatchObject({ implants: 2, patients: 1 })
  })

  it('flags under 30 implants as thin, but not a course with none', () => {
    const rows = (n: number) => Array.from({ length: n }, (_, i) => implantRow({ site_id: `s${i}` }))
    expect(one({ ...none, implants: rows(29) }).thin).toBe(true)
    expect(one({ ...none, implants: rows(30) }).thin).toBe(false)
    expect(one({ ...none, implants: [] }).thin).toBe(false)
  })

  it('splits systems and dimensions, with Not recorded for nulls, sorted by label', () => {
    const s = one({ ...none, implants: [
      implantRow({ site_id: 'a', brand: 'Oxy', system: 'PSK', diameter_mm: 4.1, length_mm: 10 }),
      implantRow({ site_id: 'b', brand: 'Oxy', system: 'PSK', diameter_mm: 3.5, length_mm: 11.5 }),
      implantRow({ site_id: 'c', brand: 'Bio', system: null, diameter_mm: 4, length_mm: 8 }),
      implantRow({ site_id: 'd', brand: null, system: null, diameter_mm: null, length_mm: null }),
    ] })
    expect(s.systems).toEqual([{ label: 'Bio', count: 1 }, { label: 'Not recorded', count: 1 }, { label: 'Oxy PSK', count: 2 }])
    expect(s.dimensions).toEqual([
      { label: 'Not recorded', count: 1 }, { label: 'Ø3.5 × 11.5 mm', count: 1 }, { label: 'Ø4.0 × 8 mm', count: 1 }, { label: 'Ø4.1 × 10 mm', count: 1 },
    ])
  })

  it('counts an attended visit as follow-up and a missed one as not', () => {
    const s = one({ radiographs: [], implants: [implantRow({ site_id: 'a' }), implantRow({ site_id: 'b' })], visits: [
      visitRow({ site_id: 'a', visit_id: 'v1', days_since_placement: 90 }),
      visitRow({ site_id: 'b', visit_id: 'v2', days_since_placement: 90, attendance: 'missed' }),
    ] })
    expect(window(s, 'm3')).toMatchObject({ attended: 1, due: 2, pending: 0 })
  })

  it('counts two attended visits in one window once', () => {
    const s = one({ radiographs: [], implants: [implantRow()], visits: [
      visitRow({ visit_id: 'v1', days_since_placement: 70 }), visitRow({ visit_id: 'v2', days_since_placement: 100 }),
    ] })
    expect(window(s, 'm3')).toMatchObject({ attended: 1, due: 1 })
  })

  it('counts an open window as pending, not due', () => {
    const s = one({ ...none, implants: [implantRow({ placed_on: '2025-11-20' })] })
    expect(window(s, 'm3')).toMatchObject({ attended: 0, due: 0, pending: 1 })
  })

  it('counts an open window with an attended visit as done, not pending', () => {
    const s = one({ radiographs: [], implants: [implantRow({ placed_on: '2025-10-01' })], visits: [visitRow({ days_since_placement: 65 })] })
    expect(window(s, 'm3')).toMatchObject({ attended: 1, due: 1, pending: 0 })
  })

  it('leaves an implant that failed before the window out of it', () => {
    const s = one({ ...none, implants: [implantRow({ event: true, event_on: '2025-02-09' })] })
    expect(window(s, 'm6')).toMatchObject({ attended: 0, due: 0, pending: 0 })
    expect(window(s, 'early')).toMatchObject({ due: 1 })
  })

  it('counts prosthetic completion among implants that have not failed', () => {
    const s = one({ ...none, implants: [
      implantRow({ site_id: 'a', final_restoration_on: '2025-06-01' }),
      implantRow({ site_id: 'b' }),
      implantRow({ site_id: 'c', event: true, event_on: '2025-03-01' }),
      implantRow({ site_id: 'd', event: true, event_on: '2025-09-01', final_restoration_on: '2025-06-01' }),
    ] })
    expect(s.prosthetic).toEqual({ done: 2, eligible: 3 })
  })

  it('sums complications and counts implants with any', () => {
    const s = one({ ...none, implants: [
      implantRow({ site_id: 'a', biological_complications: 2, mechanical_complications: 1 }),
      implantRow({ site_id: 'b', restoration_problems: 1 }),
      implantRow({ site_id: 'c' }),
    ] })
    expect(s.complications).toEqual({ biological: 2, mechanical: 1, implantsWithRestorationProblem: 1, implantsAffected: 2 })
  })

  // The reader counts a problem once per implant of the restoration: one problem on a bridge of three reads 1 each.
  it('counts a restoration problem on a bridge as implants, not as three problems', () => {
    const s = one({ ...none, implants: ['a', 'b', 'c'].map((site_id) => implantRow({ site_id, restoration_problems: 1 })) })
    const row = metricRows([s]).find((r) => r.label === 'Implants with a restoration problem')!
    expect(row.values).toEqual(['3 of 3'])
    expect(metricRows([s]).some((r) => r.label === 'Restoration problems')).toBe(false)
  })

  it('says surgical complications are not in the complication rows', () => {
    const rows = metricRows([one({ ...none, implants: [implantRow()] })])
    expect(rows.find((r) => r.label === 'Biological')!.group).toBe('Complications (surgical not included)')
    expect(rows.find((r) => r.label === 'Implants with any of these')!.values).toEqual(['0 of 1'])
  })

  it('counts each measurement once per implant', () => {
    const s = one({
      implants: [implantRow({ site_id: 'a' }), implantRow({ site_id: 'b', torque_ncm: null, isq: null, bone_type: null })],
      visits: [
        visitRow({ site_id: 'a', visit_id: 'v1', recession_facial_mm: 1, probing_max: 3 }),
        visitRow({ site_id: 'a', visit_id: 'v2', recession_mesial_mm: 2 }),
        visitRow({ site_id: 'b', visit_id: 'v3', attendance: 'missed', probing_max: 3 }),
      ],
      radiographs: [
        radiographRow({ site_id: 'a', radiograph_id: 'r1', distal_mm: 1 }),
        radiographRow({ site_id: 'b', radiograph_id: 'r2' }),
      ],
    })
    expect(measured(s, 'torque')).toBe(1)
    expect(measured(s, 'isq_placement')).toBe(1)
    expect(measured(s, 'bone_type')).toBe(1)
    expect(measured(s, 'bone_level')).toBe(1)
    expect(measured(s, 'probing')).toBe(1)
    expect(measured(s, 'recession')).toBe(1)
  })
})

describe('metricRows', () => {
  it('shows — for every ratio of a course without implants', () => {
    const rows = metricRows(courseOverview({ ...none, implants: [] }, [{ id: 'c1', name: 'New', start_date: null }], today))
    expect(rows.find((r) => r.label === 'Implants')!.values).toEqual(['0'])
    expect(rows.find((r) => r.label === 'Final restoration')!.values).toEqual(['—'])
    expect(rows.flatMap((r) => r.values).join()).not.toContain('0 of 0')
  })

  it('lines courses up, with 0 of n for a level only another course has', () => {
    const s = courseOverview({ ...none, implants: [
      implantRow({ site_id: 'a', course_id: 'c1', brand: 'Oxy', system: null }),
      implantRow({ site_id: 'b', course_id: 'c1', brand: 'Oxy', system: null }),
      implantRow({ site_id: 'c', course_id: 'c2', brand: 'Bio', system: null }),
    ] }, [c1, c2], today)
    const rows = metricRows(s)
    expect(rows.find((r) => r.group === 'Systems' && r.label === 'Oxy')!.values).toEqual(['2 of 2', '0 of 1'])
    expect(rows.find((r) => r.group === 'Systems' && r.label === 'Bio')!.values).toEqual(['0 of 2', '1 of 1'])
  })

  it('shows pending beside a follow-up ratio', () => {
    const s = one({ radiographs: [], implants: [
      implantRow({ site_id: 'a' }), implantRow({ site_id: 'b' }), implantRow({ site_id: 'c', placed_on: '2025-11-20' }),
    ], visits: [visitRow({ site_id: 'a', days_since_placement: 90 })] })
    const rows = metricRows([s])
    expect(rows.find((r) => r.group === 'Follow-up visits attended' && r.label === '3 months')!.values).toEqual(['1 of 2 · 1 pending'])
  })

  it('uses no ranking words', () => {
    const rows = metricRows([one({ ...none, implants: [implantRow()] })])
    expect(rows.map((r) => `${r.group} ${r.label}`).join(' ')).not.toMatch(/best|worst|top|rank/i)
  })
})

describe('selectedCourses', () => {
  const summaries = courseOverview({ ...none, implants: [] }, [c1, c2], today)

  it('keeps list order, drops unknown ids and duplicates', () => {
    expect(selectedCourses(['c2', 'bad', 'c1', 'c2'], summaries).map((s) => s.id)).toEqual(['c1', 'c2'])
  })

  it('reads a single value, and nothing', () => {
    expect(selectedCourses('c2', summaries).map((s) => s.id)).toEqual(['c2'])
    expect(selectedCourses(undefined, summaries)).toEqual([])
  })
})

describe('courseExploreHref', () => {
  it('opens one course, or compares several by course', () => {
    expect(courseExploreHref(['c1'])).toBe('/statistics/explore?course=c1')
    const q = new URL(courseExploreHref(['c1', NONE]), 'http://x').searchParams
    expect(Object.fromEntries(q)).toEqual({ course: 'all', f: 'course', w: 'all', x_course: `c1,${NONE}` })
    expect(parseExplore(Object.fromEntries(q)).config.filters).toEqual([{ key: 'course', values: ['c1', NONE] }])
  })

  it('filters No course recorded in Explore, because course=__none would read as all courses', () => {
    expect(new URL(courseExploreHref([NONE]), 'http://x').searchParams.get('x_course')).toBe(NONE)
  })
})

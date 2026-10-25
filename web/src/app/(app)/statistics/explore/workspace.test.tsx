import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { AnalysisData } from '@/lib/analysis/rows'
import { implantRow, radiographRow } from '@/lib/analysis/test-rows'
import type { ExploreState } from '@/lib/analysis/url'

vi.mock('./actions', () => ({ saveAnalysis: vi.fn(), deleteAnalysis: vi.fn() }))
vi.mock('./explore-chart-loader', () => ({
  ExploreChartLoader: ({ summary }: { summary: string }) => <div data-testid="chart">{summary}</div>,
  loadPalette: async () => ({ series: ['#1', '#2'], ink: '#i', muted: '#m', line: '#l' }),
}))

import { ExploreWorkspace } from './workspace'

const TODAY = '2026-09-02'
const SMOKING = ['never', 'never', 'never', 'never', 'never', 'current', 'current', 'current', 'current', null]
const BONE: (number | undefined)[] = [0.2, 0.3, 0.4, 0.5, undefined, 0.8, 0.9, 1.0, 1.1, 0.5]
const data: AnalysisData = {
  implants: SMOKING.map((s, i) => implantRow({
    site_id: `s${i}`, patient_id: `p${i}`, file_no: `F${i}`, smoking: s, tooth: i < 5 ? 16 : 36, placing_delegate_id: i < 5 ? 'd1' : 'd2',
  })),
  visits: [],
  radiographs: BONE.flatMap((b, i) => b === undefined ? [] : [radiographRow({
    site_id: `s${i}`, radiograph_id: `x${i}`, days_since_placement: 365, mesial_mm: 1, distal_mm: 1, bone_change_mm: b,
  })]),
}
const patients = Object.fromEntries(data.implants.map((r) => [r.site_id, { patientId: r.patient_id, fileNo: r.file_no, tooth: r.tooth }]))
const empty: ExploreState = { config: { factor: null, outcome: '', window: 'm12', filters: [] }, view: null }
const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})

function renderWith(initial: ExploreState = empty) {
  return render(<ExploreWorkspace data={data} labels={{ delegate: { d1: 'Zed', d2: 'Amy' } }} today={TODAY} initial={initial}
    base={{ course: 'all' }} patients={patients} />)
}
const choose = (name: string, value: string) => fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } })
const lastUrl = () => String(replaceState.mock.calls.at(-1)?.[2] ?? '')

beforeEach(() => replaceState.mockClear())

describe('ExploreWorkspace', () => {
  it('starts with the question and example questions, and an example fills the URL', () => {
    renderWith()
    expect(screen.getByRole('heading', { name: 'What would you like to understand?' })).toBeInTheDocument()
    for (const label of ['Smoking → Marginal bone change', 'Implant diameter → Implant survival', 'ISQ at placement → Marginal bone change',
      'Periodontitis history → Biological complication', 'Course → Final restoration fitted']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Smoking → Marginal bone change' }))
    expect(lastUrl()).toContain('course=all')
    expect(lastUrl()).toContain('f=smoking')
    expect(lastUrl()).toContain('o=bone_change')
  })

  it('shows the key numbers, test, findings, valid views and chart for an analysis', () => {
    renderWith()
    choose('Compare by', 'smoking')
    choose('Outcome', 'bone_change')
    const numbers = screen.getByRole('region', { name: 'Key numbers' })
    expect(within(numbers).getByText('9 of 10')).toBeInTheDocument()
    expect(within(numbers).getByText(/Mann–Whitney U/)).toBeInTheDocument()
    expect(screen.getByText('Marginal bone change was higher in the Current group in this dataset (median 0.95 vs 0.35 mm).')).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Box plot', 'Distribution', 'Table'])
    expect(screen.getByTestId('chart')).toHaveTextContent('Box plot of Marginal bone change by Smoking')
    expect(screen.getByText('No record in this window')).toBeInTheDocument()
  })

  it('resets the view when it no longer fits the outcome', () => {
    renderWith({ config: { factor: 'smoking', outcome: 'bone_change', window: 'm12', filters: [] }, view: 'strip' })
    expect(screen.getByRole('tab', { name: 'Distribution' })).toHaveAttribute('aria-selected', 'true')
    choose('Outcome', 'survival')
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Survival curve', 'Table'])
    expect(screen.getByRole('tab', { name: 'Survival curve' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('combobox', { name: 'Timepoint' })).not.toBeInTheDocument()
  })

  it('adds and removes a filter chip', () => {
    renderWith({ config: { factor: 'smoking', outcome: 'failed', window: 'm12', filters: [] }, view: null })
    const numbers = () => screen.getByRole('region', { name: 'Key numbers' })
    expect(within(numbers()).getByRole('region', { name: 'Implants' })).toHaveTextContent('10')
    fireEvent.click(screen.getByRole('button', { name: 'Add filter' }))
    choose('Filter by', 'jaw')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Mandible' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply filter' }))
    expect(screen.getByText('Jaw: Mandible')).toBeInTheDocument()
    expect(within(numbers()).getByRole('region', { name: 'Implants' })).toHaveTextContent('5')
    expect(lastUrl()).toContain('x_jaw=mandible')
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Jaw: Mandible' }))
    expect(within(numbers()).getByRole('region', { name: 'Implants' })).toHaveTextContent('10')
  })

  it('says so when no implant matches, without a chart or a test', () => {
    renderWith({ config: { factor: 'smoking', outcome: 'bone_change', window: 'm12', filters: [{ key: 'torque', min: 999 }] }, view: null })
    expect(screen.getByText('No implants match these filters.')).toBeInTheDocument()
    expect(screen.queryByTestId('chart')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Key numbers' })).not.toBeInTheDocument()
  })

  it('says no implant has a value when the filters match implants but none was measured', () => {
    renderWith({ config: { factor: 'smoking', outcome: 'isq', window: 'm12', filters: [] }, view: null })
    expect(screen.getByText('None of the 10 implants has a value for ISQ at follow-up at 12 months.')).toBeInTheDocument()
    expect(screen.queryByText('No implants match these filters.')).not.toBeInTheDocument()
  })

  it('names people, shows warnings and links the underlying rows to their patients', () => {
    renderWith({ config: { factor: 'delegate', outcome: 'bone_change', window: 'm12', filters: [] }, view: 'table' })
    const table = screen.getByRole('table', { name: 'Statistics by group' })
    expect(within(table).getAllByRole('row').slice(1).map((r) => r.querySelector('td')?.textContent)).toEqual(['Amy', 'Zed'])
    expect(screen.getByRole('region', { name: 'Data quality' })).toHaveTextContent('This group contains only 4 implants')
    fireEvent.click(screen.getByRole('button', { name: 'Show underlying data' }))
    expect(screen.getByRole('link', { name: 'F0' })).toHaveAttribute('href', '/patients/p0?tooth=16')
  })

  it('keeps the current analysis in the filters form, so Apply does not bring back an old question', () => {
    const { container } = renderWith()
    choose('Compare by', 'jaw')
    choose('Outcome', 'failed')
    const hidden = Object.fromEntries([...container.querySelectorAll('input[type=hidden][form=research-filters]')]
      .map((i) => [(i as HTMLInputElement).name, (i as HTMLInputElement).value]))
    expect(hidden).toMatchObject({ f: 'jaw', o: 'failed', w: 'm12' })
  })

  it('links the print report (optionally with the alternative chart) and the data download to the current analysis', () => {
    renderWith({ config: { factor: 'smoking', outcome: 'failed', window: 'm12', filters: [] }, view: null })
    const print = () => screen.getByRole('link', { name: 'Print report' }).getAttribute('href')!
    expect(print().startsWith('/statistics/explore/print?')).toBe(true)
    expect(print()).toContain('f=smoking')
    expect(print()).not.toContain('alt=1')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Include the alternative chart' }))
    expect(print()).toContain('alt=1')
    const csv = screen.getByRole('link', { name: 'Download data (CSV)' }).getAttribute('href')!
    expect(csv.startsWith('/statistics/explore/export?')).toBe(true)
    expect(csv).toContain('o=failed')
  })

  it('hides the timepoint for implant-level outcomes', () => {
    renderWith({ config: { factor: 'smoking', outcome: 'failed', window: 'm12', filters: [] }, view: null })
    expect(screen.queryByRole('combobox', { name: 'Timepoint' })).not.toBeInTheDocument()
    choose('Outcome', 'isq')
    expect(screen.getByRole('combobox', { name: 'Timepoint' })).toBeInTheDocument()
  })
})

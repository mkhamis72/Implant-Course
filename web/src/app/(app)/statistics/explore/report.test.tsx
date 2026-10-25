import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AnalysisData } from '@/lib/analysis/rows'
import { runAnalysis } from '@/lib/analysis/run'
import { implantRow, radiographRow } from '@/lib/analysis/test-rows'
import { ExploreReport, LIMITATIONS } from './report'

const data: AnalysisData = {
  implants: [0, 1, 2, 3, 4, 5, 6].map((i) => implantRow({ site_id: `s${i}`, patient_id: `p${i}`, smoking: i < 3 ? 'never' : 'current' })),
  visits: [],
  radiographs: [0, 1, 2, 3, 4, 5].map((i) => radiographRow({ site_id: `s${i}`, radiograph_id: `x${i}`, days_since_placement: 365, mesial_mm: 1, distal_mm: 1, bone_change_mm: i / 10 })),
}
const result = runAnalysis(data, { factor: 'smoking', outcome: 'bone_change', window: 'm12', filters: [] }, '2026-09-02')
const base = {
  result, title: 'Marginal bone change by Smoking', company: 'Kaleidoscope Academy', generated: '25 Oct 2026',
  variables: ['Compare by: Smoking', 'Outcome: Marginal bone change', 'Timepoint: 12 months'], population: ['All courses'],
  outcomeLevels: undefined, unit: 'mm',
}

describe('ExploreReport', () => {
  it('prints the findings, statistics, missing data, warnings and the limitations', () => {
    render(<ExploreReport {...base} svg={'<svg><text>chart</text></svg>'} summary="Box plot of Marginal bone change by Smoking: 2 groups, 6 implants." altSvg={null} altSummary={null} />)
    expect(LIMITATIONS).toBe('These figures describe observational data recorded at this centre. An association does not show that one thing causes another. Implants of the same patient are not independent. Small groups and missing measurements limit what can be concluded; formal conclusions need an appropriate study design and statistical advice.')
    expect(screen.getByText(LIMITATIONS)).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Marginal bone change by Smoking')
    expect(screen.getByText('Kaleidoscope Academy')).toBeInTheDocument()
    expect(screen.getByText(result.findings[0])).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Statistics by group' })).toBeInTheDocument()
    expect(screen.getByText('No record in this window')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Box plot of Marginal bone change/ })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Data quality' })).toBeInTheDocument()
  })

  it('prints without a chart when the view has none', () => {
    render(<ExploreReport {...base} svg={null} summary={null} altSvg={null} altSummary={null} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Statistics by group' })).toBeInTheDocument()
    expect(screen.getByText(LIMITATIONS)).toBeInTheDocument()
  })
})

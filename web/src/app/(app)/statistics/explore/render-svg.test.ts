// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import type { AnalysisData } from '@/lib/analysis/rows'
import { runAnalysis } from '@/lib/analysis/run'
import { implantRow, radiographRow } from '@/lib/analysis/test-rows'
import { chartOption, DEFAULT_PALETTE } from './chart-options'
import { renderChartSvg } from './render-svg'

const data: AnalysisData = {
  implants: [0, 1, 2, 3, 4, 5].map((i) => implantRow({ site_id: `s${i}`, patient_id: `p${i}`, placing_delegate_id: i < 3 ? 'd1' : 'd2' })),
  visits: [],
  radiographs: [0, 1, 2, 3, 4, 5].map((i) => radiographRow({ site_id: `s${i}`, radiograph_id: `x${i}`, days_since_placement: 365, mesial_mm: 1, distal_mm: 1, bone_change_mm: i / 10 })),
}

describe('renderChartSvg', () => {
  it('renders the chart as an SVG string on the server, with label markup escaped', () => {
    const r = runAnalysis(data, { factor: 'delegate', outcome: 'bone_change', window: 'm12', filters: [] }, '2026-09-02',
      { delegate: { d1: 'Dr <script>alert(1)</script>', d2: 'Dr A & B' } })
    const svg = renderChartSvg(chartOption('box', r, { palette: DEFAULT_PALETTE, unit: 'mm', outcomeLabel: 'Marginal bone change', factorLabel: 'Placing delegate' })!)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).not.toContain('<script')
    expect(svg).toContain('&lt;script')
    expect(svg).toContain('Dr A &amp; B')
  })
})

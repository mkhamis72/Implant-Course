import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
vi.mock('echarts/core', () => ({ init: vi.fn(() => chart), use: vi.fn() }))
vi.mock('echarts/charts', () => ({ BarChart: {}, BoxplotChart: {}, LineChart: {}, ScatterChart: {} }))
vi.mock('echarts/components', () => ({ DataZoomComponent: {}, GridComponent: {}, LegendComponent: {}, MarkLineComponent: {}, TooltipComponent: {} }))
vi.mock('echarts/renderers', () => ({ SVGRenderer: {} }))

import { init } from 'echarts/core'
import { ExploreChart, readPalette } from './explore-chart'

describe('ExploreChart', () => {
  it('renders an image role with the summary, sets the option and disposes on unmount', () => {
    const { rerender, unmount } = render(<ExploreChart option={{ series: [] }} summary="Box plot of X by Y: 2 groups, 9 implants." height={320} />)
    expect(screen.getByRole('img', { name: 'Box plot of X by Y: 2 groups, 9 implants.' })).toBeInTheDocument()
    expect(vi.mocked(init)).toHaveBeenCalledWith(expect.any(HTMLElement), undefined, { renderer: 'svg' })
    expect(chart.setOption).toHaveBeenLastCalledWith({ series: [] }, true)
    const next = { series: [{ type: 'line' as const, data: [] }] }
    rerender(<ExploreChart option={next} summary="s" height={320} />)
    expect(chart.setOption).toHaveBeenLastCalledWith(next, true)
    unmount()
    expect(chart.dispose).toHaveBeenCalled()
  })
})

describe('readPalette', () => {
  it('falls back to the validated chart colours when the tokens are not on the page', () => {
    const p = readPalette()
    expect(p.series).toEqual(['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'])
    expect(p.muted).toBe('#55666b')
  })

  it('reads the tokens when they are set', () => {
    document.documentElement.style.setProperty('--color-chart-1', '#123456')
    expect(readPalette().series[0]).toBe('#123456')
    document.documentElement.style.removeProperty('--color-chart-1')
  })
})

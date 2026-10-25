'use client';

import { useEffect, useRef } from 'react';
import { init, use as registerEcharts, type ECharts } from 'echarts/core';
import { BarChart, BoxplotChart, LineChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import { DEFAULT_PALETTE, type Palette } from './chart-options';

registerEcharts([BarChart, BoxplotChart, LineChart, ScatterChart, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

/** The Explore chart colours from the design tokens (globals.css: --color-chart-1…6, muted, line, ink). */
export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: DEFAULT_PALETTE.series.map((fallback, i) => token(`--color-chart-${i + 1}`) || fallback),
    ink: token('--color-ink') || DEFAULT_PALETTE.ink,
    muted: token('--color-muted') || DEFAULT_PALETTE.muted,
    line: token('--color-line') || DEFAULT_PALETTE.line,
  };
}

export function ExploreChart({ option, summary, height, onReady }: {
  option: EChartsOption;
  summary: string;
  height: number;
  /** The ECharts instance, for downloads. */
  onReady?: (chart: ECharts | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const c = init(box.current, undefined, { renderer: 'svg' });
    chart.current = c;
    onReady?.(c);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => c.resize());
    observer?.observe(box.current);
    return () => {
      observer?.disconnect();
      c.dispose();
      chart.current = null;
      onReady?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the chart is created once; onReady is read at that moment
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={box} role="img" aria-label={summary} style={{ height, width: '100%' }} />;
}

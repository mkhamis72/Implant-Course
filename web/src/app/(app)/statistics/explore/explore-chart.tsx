'use client';

import { useEffect, useRef } from 'react';
import { init, use as registerEcharts, type ECharts } from 'echarts/core';
import { BarChart, BoxplotChart, LineChart, ScatterChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';
import type { Palette } from './chart-options';

registerEcharts([BarChart, BoxplotChart, LineChart, ScatterChart, DataZoomComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent, SVGRenderer]);

/** The Explore chart colours from the design tokens (globals.css: --color-chart-1…6, muted, line, ink). */
export function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: [1, 2, 3, 4, 5, 6].map((i) => token(`--color-chart-${i}`)).filter(Boolean),
    ink: token('--color-ink') || '#17262b',
    muted: token('--color-muted') || '#55666b',
    line: token('--color-line') || '#d9e2df',
  };
}

export function ExploreChart({ option, summary, height }: { option: EChartsOption; summary: string; height: number }) {
  const box = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);

  useEffect(() => {
    if (!box.current) return;
    const c = init(box.current, undefined, { renderer: 'svg' });
    chart.current = c;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => c.resize());
    observer?.observe(box.current);
    return () => {
      observer?.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={box} role="img" aria-label={summary} style={{ height, width: '100%' }} />;
}

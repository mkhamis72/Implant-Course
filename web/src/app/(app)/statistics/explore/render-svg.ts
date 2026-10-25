import 'server-only';
import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';

/** An Explore chart as an SVG string, drawn on the server for the print report (vector, so it stays sharp in a PDF). */
export function renderChartSvg(option: EChartsOption, width = 720, height = 340): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height });
  try {
    chart.setOption({ ...option, animation: false });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

'use client';

import dynamic from 'next/dynamic';

// ECharts is loaded only on the Explore page, in the browser.
export const ExploreChartLoader = dynamic(() => import('./explore-chart').then((m) => m.ExploreChart), {
  ssr: false,
  loading: () => <div className="card animate-pulse" style={{ height: 320 }} aria-hidden="true" />,
});

export async function loadPalette() {
  return (await import('./explore-chart')).readPalette();
}

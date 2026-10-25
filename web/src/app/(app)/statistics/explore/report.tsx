import type { AnalysisResult } from '@/lib/analysis/run';
import type { Level } from '@/lib/analysis/variables';
import { Findings, Included, KeyNumbers, Quality, StatsTable } from './results';

export const LIMITATIONS = 'These figures describe observational data recorded at this centre. An association does not show that one thing causes another. Implants of the same patient are not independent. Small groups and missing measurements limit what can be concluded; formal conclusions need an appropriate study design and statistical advice.';

function Chart({ svg, summary }: { svg: string; summary: string }) {
  // The SVG comes from ECharts on the server, built from our own option; ECharts escapes every text it draws.
  return <figure role="img" aria-label={summary} className="card break-inside-avoid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** The printable Explore report (Save as PDF from the browser). */
export function ExploreReport({ result, title, company, generated, variables, population, outcomeLevels, unit, svg, summary, altSvg, altSummary }: {
  result: AnalysisResult;
  title: string;
  company: string;
  generated: string;
  variables: string[];
  population: string[];
  outcomeLevels?: Level[];
  unit?: string;
  svg: string | null;
  summary: string | null;
  altSvg: string | null;
  altSummary: string | null;
}) {
  return (
    <article className="mx-auto max-w-[210mm] space-y-4">
      <header className="space-y-1">
        <p className="text-sm text-muted">{company}</p>
        <h1>Explore clinical data — {title}</h1>
        <p className="text-sm text-muted">Generated {generated}</p>
      </header>
      <section aria-label="Analysis" className="card space-y-1 text-sm">
        {variables.map((v) => <p key={v}>{v}</p>)}
        <p>Population: {result.implants} implants, {result.patients} patients</p>
        {population.map((p) => <p key={p} className="text-muted">{p}</p>)}
      </section>
      {svg && summary && <Chart svg={svg} summary={summary} />}
      {altSvg && altSummary && <Chart svg={altSvg} summary={altSummary} />}
      {result.included > 0 && <KeyNumbers r={result} />}
      <StatsTable r={result} levels={outcomeLevels} unit={unit} />
      <Findings r={result} />
      <Included r={result} />
      <Quality r={result} />
      <section aria-label="Limitations" className="card text-sm">
        <h2 className="font-semibold">Limitations</h2>
        <p>{LIMITATIONS}</p>
      </section>
    </article>
  );
}

// Measures one passport render: npx tsx scripts/passport-spike.ts <document module> <out.pdf> [runs]
// The module's default export returns the React PDF <Document> element (sync or async).
// Prints, per run, the render time, heap used and PDF bytes; the first run is cold (fonts load).
//
// @react-pdf/* are ESM-only with "import"-only exports, and tsx runs this repo's .ts/.tsx as CommonJS
// (its require hook would rewrite them and fail on '@react-pdf/hyphenate/en-us'). So the document
// module is bundled with esbuild (packages left external) into an .mjs under node_modules/.cache and
// loaded with a native import(), which resolves @react-pdf the way Next.js does.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import type { ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';

type DocumentFactory = () => ReactElement<DocumentProps> | Promise<ReactElement<DocumentProps>>;
type Loaded = {
  default: DocumentFactory;
  renderToBuffer: (doc: ReactElement<DocumentProps>) => Promise<Buffer>;
};

const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

async function load(modulePath: string): Promise<Loaded> {
  const dir = path.resolve('node_modules', '.cache', 'passport-spike');
  mkdirSync(dir, { recursive: true });
  const outfile = path.join(dir, `doc-${Date.now()}.mjs`);
  const entry = path.resolve(modulePath).replace(/\\/g, '/');
  await build({
    stdin: {
      contents: `export { default } from ${JSON.stringify(entry)};\nexport { renderToBuffer } from '@react-pdf/renderer';\n`,
      resolveDir: process.cwd(),
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    jsx: 'automatic',
    outfile,
    logLevel: 'warning',
  });
  return (await import(pathToFileURL(outfile).href)) as Loaded;
}

async function main() {
  const [modulePath, outPath, runsArg] = process.argv.slice(2);
  if (!modulePath || !outPath) {
    console.error('Usage: npx tsx scripts/passport-spike.ts <document module> <out.pdf> [runs]');
    process.exit(1);
  }
  const runs = Math.max(1, Number(runsArg ?? 3) || 1);
  const { default: factory, renderToBuffer } = await load(modulePath);
  let pdf: Buffer = Buffer.alloc(0);
  let peakRss = 0;
  for (let run = 1; run <= runs; run++) {
    const started = performance.now();
    pdf = await renderToBuffer(await factory());
    const ms = performance.now() - started;
    const { heapUsed, rss } = process.memoryUsage();
    peakRss = Math.max(peakRss, rss);
    console.log(
      `run ${run} (${run === 1 ? 'cold' : 'warm'}): ${ms.toFixed(0)} ms, heap ${mb(heapUsed)} MB, rss ${mb(rss)} MB, ${pdf.length} bytes`,
    );
  }
  writeFileSync(outPath, pdf);
  console.log(`peak rss ${mb(peakRss)} MB; wrote ${outPath} (starts with %PDF-: ${pdf.subarray(0, 5).toString() === '%PDF-'})`);
}

void main();

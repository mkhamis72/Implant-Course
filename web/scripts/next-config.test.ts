import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import nextConfig from '../next.config';

const require = createRequire(import.meta.url);
const glob: (p: string, o: object, cb: (e: Error | null, f: string[]) => void) => void = require('next/dist/compiled/glob');
const web = path.resolve(__dirname, '..');
const files = (pattern: string) =>
  new Promise<string[]>((resolve, reject) =>
    glob(pattern, { cwd: web, nodir: true, dot: true }, (e, f) => (e ? reject(e) : resolve(f.map((x) => path.resolve(web, x))))));

// Files the passport generate route reads at run time that file tracing cannot see: without them it fails only on
// Vercel (2026-11-27: pdfkit's standard-fonts/Helvetica.cjs missing), never locally.
describe('next.config outputFileTracingIncludes for the passport generate route', () => {
  const includes = nextConfig.outputFileTracingIncludes?.['/patients/*/passport/generate'] ?? [];

  it('ships pdfkit\'s standard fonts for every pdfkit copy in node_modules', async () => {
    const included = new Set((await Promise.all(includes.map(files))).flat());
    const copies = ['node_modules/pdfkit', 'node_modules/@react-pdf/font/node_modules/pdfkit']
      .map((p) => path.resolve(web, p, 'js/standard-fonts/Helvetica.cjs'))
      .filter(existsSync);
    expect(copies.length).toBeGreaterThan(0);
    for (const file of copies) expect(included).toContain(file);
  });

  it('ships the bundled passport fonts', async () => {
    const included = (await Promise.all(includes.map(files))).flat();
    expect(included.some((f) => f.endsWith('IBMPlexSansArabic-Regular.ttf'))).toBe(true);
  });
});

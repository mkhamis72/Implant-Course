import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import nextConfig from '../next.config';

type Webpack = (config: { resolve: { alias: Record<string, string> } }, ctx: { isServer: boolean }) => {
  resolve: { alias: Record<string, string> };
};
const webpack = nextConfig.webpack as unknown as Webpack;

describe('next.config', () => {
  it('traces analysis.R into the routes that read it, and nothing for the passport (drawn in the browser)', () => {
    expect(Object.keys(nextConfig.outputFileTracingIncludes ?? {})).toEqual(['/statistics/export', '/statistics/analysis.R']);
  });

  // Two pdfkit copies are installed; in the browser bundle both must be @react-pdf/font's, or the passport fails
  // with 'Standard font "Helvetica" is not registered'.
  it("points the browser bundle's pdfkit at @react-pdf/font's copy, which exists", () => {
    const client = webpack({ resolve: { alias: {} } }, { isServer: false });
    expect(client.resolve.alias['pdfkit$']).toMatch(/@react-pdf[\\/]font[\\/]node_modules[\\/]pdfkit[\\/]js[\\/]pdfkit\.browser\.mjs$/);
    expect(existsSync(client.resolve.alias['pdfkit$'])).toBe(true);
  });

  it('leaves the server bundle alone', () => {
    expect(webpack({ resolve: { alias: {} } }, { isServer: true }).resolve.alias).toEqual({});
  });
});

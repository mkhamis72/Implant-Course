import { readFileSync } from 'node:fs';
import path from 'node:path';

// Read from the source tree at run time (next.config.ts traces it into the server bundle of the routes that use it).
const SCRIPT_PATH = path.join(process.cwd(), 'src', 'lib', 'research', 'export', 'analysis.R');

let cached: string | null = null;

/** The R analysis script shipped in the CSV export and offered on the Research page. */
export function analysisScript(): string {
  cached ??= readFileSync(SCRIPT_PATH, 'utf8');
  return cached;
}

// npm run catalog:load -- --in <file.csv> [--apply]
// Loads a catalogue CSV (the docs/catalog/oxy-catalog.csv columns) into the shared library, public.catalog_items
// (0128): adds new items, updates changed ones, retires the file's brands' items missing from it. A dry run unless
// --apply. Never touches a company's products: a company switches items on in Admin → Catalogue.
import './load-env';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { pgConfig } from './db';
import { diffLibrary, parseCatalogCsv, type ExistingItem, type LibraryRow } from './catalog-library';
import { targetLabel } from './create-user-args';
import { refuseRemovedOptions } from './one-database';

function args(argv: string[]): { file: string; apply: boolean } {
  const i = argv.indexOf('--in');
  const file = i >= 0 ? argv[i + 1] : undefined;
  if (!file) throw new Error('Usage: npm run catalog:load -- --in <file.csv> [--apply]');
  return { file, apply: argv.includes('--apply') };
}

const COLUMNS = 'type, brand, system, platform, diameter_mm, length_mm, ref_code, description, source';
const values = (r: LibraryRow) =>
  [r.type, r.brand, r.system, r.platform, r.diameter_mm, r.length_mm, r.ref_code, r.description, r.source];

async function main() {
  const argv = process.argv.slice(2);
  refuseRemovedOptions(argv);
  const { file, apply } = args(argv);
  console.log(`Target project: ${targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const incoming = parseCatalogCsv(readFileSync(file, 'utf8'));
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    await pg.query('begin');
    const { rows } = await pg.query<ExistingItem>(
      `select id, type, brand, system, platform, diameter_mm::float8 as diameter_mm, length_mm::float8 as length_mm,
              ref_code, description, source, retired
       from public.catalog_items for update`);
    const diff = diffLibrary(rows, incoming);
    console.log(`Added ${diff.add.length}, updated ${diff.update.length}, retired ${diff.retire.length}`);
    if (!apply) {
      await pg.query('rollback');
      console.log('Dry run: nothing written. Add --apply to write.');
      return;
    }
    for (const r of diff.add) {
      await pg.query(`insert into public.catalog_items (${COLUMNS}) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, values(r));
    }
    for (const { id, row } of diff.update) {
      await pg.query(`update public.catalog_items set system = $2, platform = $3, description = $4, source = $5,
        retired = false where id = $1`, [id, row.system, row.platform, row.description, row.source]);
    }
    if (diff.retire.length) {
      await pg.query('update public.catalog_items set retired = true where id = any ($1)', [diff.retire]);
    }
    await pg.query('commit');
    console.log('Written.');
  } catch (error) {
    await pg.query('rollback').catch(() => {});
    throw error;
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});

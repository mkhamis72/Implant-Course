import './load-env';
import { writeFileSync } from 'node:fs';
import { Client } from 'pg';
import { pgConfig } from './db';
import { toCsv } from '../src/lib/csv';
import { CATALOG_HEADERS, catalogRow, type CatalogProduct } from './catalog-csv';
import { targetLabel } from './create-user-args';

async function main() {
  console.log(`Target project: ${targetLabel(process.env.NEXT_PUBLIC_SUPABASE_URL)}`);
  const pg = new Client(pgConfig());
  await pg.connect();
  try {
    const { rows } = await pg.query<CatalogProduct>(
      `select type, brand, system, platform, diameter_mm::float8 as diameter_mm, length_mm::float8 as length_mm,
              ref_code, description, is_sample, active
       from public.products order by type, brand, system, diameter_mm, length_mm`,
    );
    const file = `catalog-${new Date().toISOString().slice(0, 10)}.csv`;
    writeFileSync(file, toCsv(CATALOG_HEADERS, rows.map(catalogRow)));
    console.log(`Wrote ${rows.length} products to ${file}`);
  } finally {
    await pg.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});

import { strToU8, zipSync } from 'fflate';
import { toCsv } from './csv';
import { DICTIONARY, TABLE_NAMES, assertAllowlisted, type ExportTables } from './dictionary';
import { DICTIONARY_COLUMNS, dictionaryRows, readmeText, type ExportMeta } from './assemble';
import { analysisScript } from './analysis';

/** One CSV per table (dictionary column order), data_dictionary.csv, README.txt and analysis.R. Throws on a column outside the dictionary. */
export function buildZip(tables: ExportTables, meta: ExportMeta): Uint8Array {
  assertAllowlisted(tables);
  const files: Record<string, Uint8Array> = {};
  for (const t of TABLE_NAMES) files[`${t}.csv`] = strToU8(toCsv(tables[t], Object.keys(DICTIONARY[t])));
  files['data_dictionary.csv'] = strToU8(toCsv(dictionaryRows(), DICTIONARY_COLUMNS));
  files['README.txt'] = strToU8(readmeText(meta));
  files['analysis.R'] = strToU8(analysisScript());
  return zipSync(files);
}

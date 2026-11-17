import { strToU8, zipSync } from 'fflate';
import { toCsv } from './csv';
import { TABLE_NAMES, dictionaryFor, assertAllowlisted, type ExportTables } from './dictionary';
import { DICTIONARY_COLUMNS, dictionaryRows, readmeText, type ExportMeta } from './assemble';
import { analysisScript } from './analysis';

/** One CSV per table (dictionary column order), data_dictionary.csv, README.txt and analysis.R. Throws on a column outside the dictionary. */
export function buildZip(tables: ExportTables, meta: ExportMeta): Uint8Array {
  assertAllowlisted(tables);
  const teaching = meta.teaching !== false;
  const dictionary = dictionaryFor(teaching);
  const files: Record<string, Uint8Array> = {};
  for (const t of TABLE_NAMES) files[`${t}.csv`] = strToU8(toCsv(tables[t], Object.keys(dictionary[t])));
  files['data_dictionary.csv'] = strToU8(toCsv(dictionaryRows(teaching), DICTIONARY_COLUMNS));
  files['README.txt'] = strToU8(readmeText(meta));
  // The script stratifies by course and placing delegate, which a clinic's file doesn't have.
  if (teaching) files['analysis.R'] = strToU8(analysisScript());
  return zipSync(files);
}

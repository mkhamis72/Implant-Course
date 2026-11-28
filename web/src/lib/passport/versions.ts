import { sniffLogo } from '@/lib/branding/image';

/**
 * Audit rows about the passports themselves: generating one is not a change to the patient's records, so they never
 * mark a passport (otherwise the newest would always be). The old stored-passport tables (0145) are no longer written and are kept for one release.
 */
const PASSPORT_TABLES = new Set(['patient_passports', 'passport_downloads', 'passport_settings', 'passport_generations']);

/**
 * "Records changed since this version": any audit row of the patient's records (patient_history's rows) newer than
 * the passport's generated_at.
 */
export function recordsChangedSince(generatedAt: string, history: { table_name: string; at: string }[]): boolean {
  const since = Date.parse(generatedAt);
  return history.some((h) => !PASSPORT_TABLES.has(h.table_name) && Date.parse(h.at) > since);
}

/**
 * The logo the passport can print, as a data URL (the model is sent to the browser as JSON): PNG or JPEG, judged by
 * its bytes. react-pdf cannot draw WebP, so a WebP logo (allowed in Branding) is left out and the clinic name prints
 * alone. Server side only (Buffer).
 */
export function printableLogo(bytes: Uint8Array | null): string | null {
  if (!bytes) return null;
  const type = sniffLogo(bytes);
  return type === 'image/png' || type === 'image/jpeg' ? `data:${type};base64,${Buffer.from(bytes).toString('base64')}` : null;
}

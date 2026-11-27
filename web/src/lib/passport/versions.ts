import { formatDate } from '@/lib/format';
import { sniffLogo } from '@/lib/branding/image';

/**
 * Audit rows about the passports themselves: generating or downloading one is not a change to the patient's records,
 * so they never make a version stale (otherwise the newest version would always be).
 */
const PASSPORT_TABLES = new Set(['patient_passports', 'passport_downloads', 'passport_settings']);

/**
 * "Records changed since this version": any audit row of the patient's records (patient_history's rows, 0145) newer
 * than the version's generated_at.
 */
export function recordsChangedSince(generatedAt: string, history: { table_name: string; at: string }[]): boolean {
  const since = Date.parse(generatedAt);
  return history.some((h) => !PASSPORT_TABLES.has(h.table_name) && Date.parse(h.at) > since);
}

const cairoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** "Downloaded N times, last by <name> on <Cairo date>", or "Not downloaded yet". */
export function downloadSummary(downloads: { downloaded_at: string; by: string | null }[]): string {
  if (!downloads.length) return 'Not downloaded yet';
  const last = downloads.reduce((a, b) => (Date.parse(b.downloaded_at) > Date.parse(a.downloaded_at) ? b : a));
  const n = downloads.length;
  return `Downloaded ${n} ${n === 1 ? 'time' : 'times'}, last by ${last.by || 'Unknown'} on ${formatDate(cairoDay.format(new Date(last.downloaded_at)))}`;
}

/**
 * A Content-Disposition for a download: the name quoted with anything outside printable ASCII, quotes and
 * backslashes replaced (no header injection), plus the exact name as RFC 5987 `filename*`.
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * The logo the passport can print: PNG or JPEG, judged by its bytes. react-pdf cannot draw WebP, so a WebP logo
 * (allowed in Branding) is left out and the clinic name prints alone.
 */
export function printableLogo(bytes: Uint8Array | null): { bytes: Uint8Array; contentType: 'image/png' | 'image/jpeg' } | null {
  if (!bytes) return null;
  const type = sniffLogo(bytes);
  return type === 'image/png' || type === 'image/jpeg' ? { bytes, contentType: type } : null;
}

/** "84 KB", "1.2 MB". */
export function sizeLabel(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

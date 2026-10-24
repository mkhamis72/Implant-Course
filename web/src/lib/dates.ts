import { APP_TIME_ZONE } from '@/lib/format';

export function isRealDate(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/** Today's date in the clinic's time zone (en-CA formats as YYYY-MM-DD). */
export function todayIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const dates = (values: (string | null | undefined)[]) => values.filter((v): v is string => Boolean(v)).sort();

/** The latest of some ISO dates (they sort as text), ignoring empty ones. */
export function latestDate(values: (string | null | undefined)[]): string | undefined {
  return dates(values).at(-1);
}

/** The earliest of some ISO dates, ignoring empty ones. */
export function earliestDate(values: (string | null | undefined)[]): string | undefined {
  return dates(values)[0];
}

export const APP_TIME_ZONE = 'Africa/Cairo';

const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: APP_TIME_ZONE });
const dateTime = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: APP_TIME_ZONE,
});
const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

/** A plain calendar date ("YYYY-MM-DD") — no time zone shift. */
export function formatDate(isoDate: string): string {
  return date.format(new Date(`${isoDate}T00:00:00Z`));
}

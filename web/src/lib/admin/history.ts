import { APP_TIME_ZONE, formatDate } from '@/lib/format';

/** One row of admin_user_history. actor_name is null when the actor's profile is gone (or nobody was signed in). */
export type HistoryEntry = { at: string; actor_name: string | null; kind: string };

const ACTIONS: Record<string, string> = {
  email_changed: 'Email changed',
  name_changed: 'Name changed',
  mfa_reset: '2FA reset',
  invite_resent: 'Invite resent',
};

const cairoDay = new Intl.DateTimeFormat('en-CA', { timeZone: APP_TIME_ZONE });

/** "Email changed by Dr Admin · 23 Oct 2026" (the date in Cairo); without an actor, "Email changed · 23 Oct 2026". */
export function historyLabel({ at, actor_name, kind }: HistoryEntry): string {
  const date = formatDate(cairoDay.format(new Date(at)));
  if (kind === 'email_change_incomplete') return `Email change incomplete · ${date}`;
  const action = ACTIONS[kind] ?? kind;
  return actor_name ? `${action} by ${actor_name} · ${date}` : `${action} · ${date}`;
}

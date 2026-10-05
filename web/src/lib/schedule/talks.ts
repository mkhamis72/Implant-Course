import type { SessionType } from './types';

/** Route segment → session type. Lectures and workshops share one set of pages. */
export const TALK_KINDS = {
  lectures: { type: 'lecture', title: 'Lectures', noun: 'lecture' },
  workshops: { type: 'workshop', title: 'Workshops', noun: 'workshop' },
} as const satisfies Record<string, { type: SessionType; title: string; noun: string }>;
export type TalkKind = keyof typeof TALK_KINDS;

export function isTalkKind(v: unknown): v is TalkKind {
  return v === 'lectures' || v === 'workshops';
}

export function talkKindOf(type: SessionType): TalkKind | null {
  return type === 'lecture' ? 'lectures' : type === 'workshop' ? 'workshops' : null;
}

export type TalkRow = {
  id: string; session_id: string; starts_at: string; ends_at: string; topic: string; notes: string;
  lecturer_id: string; lecturer: { full_name: string } | null;
};

export type DaySessionRow = {
  id: string; title: string; date: string; start_time: string; end_time: string; room: string | null;
  course: { name: string } | null; talks: TalkRow[];
};

export const TALK_SELECT = `
  id, session_id, starts_at, ends_at, topic, notes, lecturer_id,
  lecturer:lecturers!talks_lecturer_id_fkey(full_name)
`;

export const DAY_SESSION_SELECT = `
  id, title, date, start_time, end_time, room,
  course:courses(name),
  talks(${TALK_SELECT})
`;

'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import type { Option } from '@/lib/inventory/types';
import type { TalkKind } from '@/lib/schedule/talks';
import { createTalk, updateTalk } from './actions';

type Initial = { talkId?: string; sessionId: string; start: string; end: string; lecturerId: string; topic: string; notes: string };

export function TalkForm({
  kind, sessions = [], sessionLabel, lecturers, initial,
}: { kind: TalkKind; sessions?: Option[]; sessionLabel?: string; lecturers: Option[]; initial: Initial }) {
  const editing = Boolean(initial.talkId);
  const [state, action, pending] = useActionState<FormState, FormData>(editing ? updateTalk : createTalk, {});
  // React resets the form after each action, and a <select> falls back to its first option rather than
  // its defaultValue. Remounting on every result rebuilds the fields from the submitted values instead.
  const [seen, setSeen] = useState(state);
  const [attempt, setAttempt] = useState(0);
  if (state !== seen) {
    setSeen(state);
    setAttempt(attempt + 1);
  }
  return (
    <form key={attempt} action={action} className="card grid max-w-2xl gap-4 sm:grid-cols-2">
      <input type="hidden" name="kind" value={kind} readOnly />
      {editing ? (
        <>
          <input type="hidden" name="talk_id" value={initial.talkId} readOnly />
          <div className="sm:col-span-2">
            <span className="label">Session</span>
            <p>{sessionLabel}</p>
          </div>
        </>
      ) : (
        <label className="block sm:col-span-2">
          <span className="label">Session</span>
          <select className="input" name="session_id" defaultValue={valueOf(state, 'session_id', initial.sessionId)}>
            <option value="">—</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </label>
      )}
      <label className="block">
        <span className="label">Start</span>
        <input className="input" type="time" name="start" defaultValue={valueOf(state, 'start', initial.start)} />
      </label>
      <label className="block">
        <span className="label">End</span>
        <input className="input" type="time" name="end" defaultValue={valueOf(state, 'end', initial.end)} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Lecturer</span>
        <select className="input" name="lecturer_id" defaultValue={valueOf(state, 'lecturer_id', initial.lecturerId)}>
          <option value="">—</option>
          {lecturers.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
      </label>
      {lecturers.length === 0 && (
        <p className="text-sm text-muted sm:col-span-2">
          No lecturers yet — an admin adds them in <Link href="/admin/lecturers" className="text-accent hover:underline">Admin → Lecturers</Link>.
        </p>
      )}
      <label className="block sm:col-span-2">
        <span className="label">Topic</span>
        <input className="input" name="topic" defaultValue={valueOf(state, 'topic', initial.topic)} />
      </label>
      <label className="block sm:col-span-2">
        <span className="label">Notes (optional)</span>
        <textarea className="input" name="notes" rows={2} defaultValue={valueOf(state, 'notes', initial.notes)} />
      </label>
      {state.error && <p role="alert" className="text-sm text-bad sm:col-span-2">{state.error}</p>}
      <div className="sm:col-span-2">
        <button className="btn" disabled={pending}>Save talk</button>
      </div>
    </form>
  );
}

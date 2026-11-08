'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import type { TalkKind } from '@/lib/schedule/talks';
import { deleteTalk } from './actions';

export function DeleteTalk({ talkId, kind }: { talkId: string; kind: TalkKind }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteTalk, {});
  return (
    <details className="text-sm">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center px-3 text-bad hover:underline [&::-webkit-details-marker]:hidden">Delete</summary>
      <form action={action} className="mb-2">
        <input type="hidden" name="talk_id" value={talkId} readOnly />
        <input type="hidden" name="kind" value={kind} readOnly />
        <button className="btn-danger btn" disabled={pending}>Delete talk</button>
        {state.error && <p role="alert" className="text-bad">{state.error}</p>}
      </form>
    </details>
  );
}

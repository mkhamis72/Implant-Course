'use client';

import { useActionState } from 'react';
import type { FormState } from '@/lib/patients/form-state';
import type { TalkKind } from '@/lib/schedule/talks';
import { deleteTalk } from './actions';

export function DeleteTalk({ talkId, kind }: { talkId: string; kind: TalkKind }) {
  const [state, action, pending] = useActionState<FormState, FormData>(deleteTalk, {});
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-bad">Delete</summary>
      <form action={action} className="mt-1">
        <input type="hidden" name="talk_id" value={talkId} readOnly />
        <input type="hidden" name="kind" value={kind} readOnly />
        <button className="btn-danger btn py-0.5 text-xs" disabled={pending}>Delete talk</button>
        {state.error && <p role="alert" className="text-bad">{state.error}</p>}
      </form>
    </details>
  );
}

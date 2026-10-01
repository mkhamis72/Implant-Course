'use client';

import { useEffect } from 'react';
import { createIdleTimer } from '@/lib/idle';
import { createClient } from '@/lib/supabase/client';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const;

async function signOutForIdle() {
  await createClient().auth.signOut();
  window.location.assign('/login?reason=idle');
}

export function IdleTimer({ timeoutMinutes, onIdle = signOutForIdle }: { timeoutMinutes: number; onIdle?: () => void }) {
  useEffect(() => {
    const timer = createIdleTimer(timeoutMinutes * 60_000, onIdle);
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, timer.reset, { passive: true }));
    return () => {
      timer.stop();
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, timer.reset));
    };
  }, [timeoutMinutes, onIdle]);
  return null;
}

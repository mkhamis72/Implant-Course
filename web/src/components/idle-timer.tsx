'use client';

import { useEffect } from 'react';
import { createIdleTimer } from '@/lib/idle';
import { createClient } from '@/lib/supabase/client';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const;

/** Shared across tabs so activity in any tab keeps the others alive. */
export const LAST_ACTIVITY_KEY = 'icm-last-activity';
const BROADCAST_EVERY_MS = 5_000;

async function signOutForIdle() {
  // 'local' ends only this browser's session; 'global' would also sign out other devices.
  await createClient().auth.signOut({ scope: 'local' });
  window.location.assign('/login?reason=idle');
}

export function IdleTimer({ timeoutMinutes, onIdle = signOutForIdle }: { timeoutMinutes: number; onIdle?: () => void }) {
  useEffect(() => {
    const timer = createIdleTimer(timeoutMinutes * 60_000, onIdle);
    let lastBroadcast = 0;

    function onLocalActivity() {
      timer.reset();
      const now = Date.now();
      if (now - lastBroadcast < BROADCAST_EVERY_MS) return;
      lastBroadcast = now;
      try {
        window.localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      } catch {
        // Storage unavailable (private mode): this tab still tracks its own activity.
      }
    }

    function onStorage(event: StorageEvent) {
      if (event.key === LAST_ACTIVITY_KEY) timer.reset();
    }

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, onLocalActivity, { passive: true }));
    window.addEventListener('storage', onStorage);
    return () => {
      timer.stop();
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, onLocalActivity));
      window.removeEventListener('storage', onStorage);
    };
  }, [timeoutMinutes, onIdle]);
  return null;
}

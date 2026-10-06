'use client';

import { useEffect } from 'react';
import { createIdleTimer } from '@/lib/idle';
import { createClient } from '@/lib/supabase/client';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const;

/** Shared across tabs so activity in any tab keeps the others alive. */
export const LAST_ACTIVITY_KEY = 'icm-last-activity';
const BROADCAST_EVERY_MS = 5_000;
// Lets the server-side idle check (middleware) see activity that makes no requests, e.g. typing.
const HEARTBEAT_EVERY_MS = 60_000;

async function signOutForIdle(supabase: { url: string; anonKey: string }) {
  // 'local' ends only this browser's session; 'global' would also sign out other devices.
  await createClient(supabase.url, supabase.anonKey).auth.signOut({ scope: 'local' });
  window.location.assign('/login?reason=idle');
}

export function IdleTimer({
  timeoutMinutes,
  supabase,
  onIdle,
}: {
  timeoutMinutes: number;
  supabase?: { url: string; anonKey: string };
  onIdle?: () => void;
}) {
  useEffect(() => {
    const handleIdle = onIdle ?? (() => supabase && signOutForIdle(supabase));
    const timer = createIdleTimer(timeoutMinutes * 60_000, handleIdle);
    let lastBroadcast = 0;
    let lastHeartbeat = 0;

    function onLocalActivity() {
      timer.reset();
      const now = Date.now();
      if (now - lastHeartbeat >= HEARTBEAT_EVERY_MS) {
        lastHeartbeat = now;
        fetch('/api/activity', { method: 'POST' }).catch(() => {});
      }
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
  }, [timeoutMinutes, onIdle, supabase?.url, supabase?.anonKey]);
  return null;
}

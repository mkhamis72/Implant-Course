'use client';

import { useEffect } from 'react';
import { createIdleTimer } from '@/lib/idle';

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart'] as const;

/** Shared across tabs so activity in any tab keeps the others alive. */
export const LAST_ACTIVITY_KEY = 'icm-last-activity';
const BROADCAST_EVERY_MS = 5_000;
// Lets the server-side idle check (middleware) see activity that makes no requests, e.g. typing.
const HEARTBEAT_EVERY_MS = 60_000;

async function signOutForIdle(signOutPath: string, loginPath: string) {
  // The server ends only this browser's session; the browser never talks to the database or Supabase Auth.
  // A failed revoke is retried once; either way the user goes to sign-in (the server's idle check is the backstop).
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(signOutPath, { method: 'POST' }).catch(() => null);
    if (res?.ok) break;
  }
  window.location.assign(`${loginPath}?reason=idle`);
}

export function IdleTimer({
  timeoutMinutes,
  onIdle,
  loginPath = '/login',
  signOutPath = '/auth/signout',
  heartbeatPath = '/api/activity',
}: {
  timeoutMinutes: number;
  onIdle?: () => void;
  loginPath?: string;
  signOutPath?: string;
  heartbeatPath?: string;
}) {
  useEffect(() => {
    const handleIdle = onIdle ?? (() => void signOutForIdle(signOutPath, loginPath));
    const timer = createIdleTimer(timeoutMinutes * 60_000, handleIdle);
    let lastBroadcast = 0;
    let lastHeartbeat = 0;

    function onLocalActivity() {
      timer.reset();
      const now = Date.now();
      if (now - lastHeartbeat >= HEARTBEAT_EVERY_MS) {
        lastHeartbeat = now;
        fetch(heartbeatPath, { method: 'POST' }).catch(() => {});
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
  }, [timeoutMinutes, onIdle, loginPath, signOutPath, heartbeatPath]);
  return null;
}

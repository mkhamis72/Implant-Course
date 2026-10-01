export function createIdleTimer(timeoutMs: number, onIdle: () => void) {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let fired = false;

  function stop() {
    if (handle) clearTimeout(handle);
    handle = undefined;
  }

  function reset() {
    if (fired) return;
    stop();
    handle = setTimeout(() => {
      fired = true;
      onIdle();
    }, timeoutMs);
  }

  reset();
  return { reset, stop };
}

/** Server-side check: has more than `timeoutMinutes` passed since the last request? */
export function isIdleExpired(lastSeenMs: number | null, nowMs: number, timeoutMinutes: number): boolean {
  if (lastSeenMs === null || !Number.isFinite(lastSeenMs)) return false;
  return nowMs - lastSeenMs > timeoutMinutes * 60_000;
}

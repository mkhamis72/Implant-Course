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

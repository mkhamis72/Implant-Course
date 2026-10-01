import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createIdleTimer } from './idle';

describe('createIdleTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires once after the timeout with no activity', () => {
    const onIdle = vi.fn();
    createIdleTimer(1000, onIdle);
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('activity pushes the deadline back', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer(1000, onIdle);
    vi.advanceTimersByTime(800);
    timer.reset();
    vi.advanceTimersByTime(800);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stop cancels it', () => {
    const onIdle = vi.fn();
    const timer = createIdleTimer(1000, onIdle);
    timer.stop();
    vi.advanceTimersByTime(2000);
    expect(onIdle).not.toHaveBeenCalled();
  });
});

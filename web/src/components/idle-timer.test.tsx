import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { IdleTimer } from './idle-timer';

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }));

describe('<IdleTimer>', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('calls onIdle after the configured minutes, reset by key presses', () => {
    const onIdle = vi.fn();
    render(<IdleTimer timeoutMinutes={5} onIdle={onIdle} />);
    vi.advanceTimersByTime(4 * 60_000);
    fireEvent.keyDown(window);
    vi.advanceTimersByTime(4 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});

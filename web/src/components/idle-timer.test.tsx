import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { IdleTimer, LAST_ACTIVITY_KEY } from './idle-timer';

const signOut = vi.fn();
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut } }) }));

describe('<IdleTimer>', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    signOut.mockReset();
  });
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

  it('activity in another tab (storage event) keeps this tab alive', () => {
    const onIdle = vi.fn();
    render(<IdleTimer timeoutMinutes={5} onIdle={onIdle} />);
    vi.advanceTimersByTime(4 * 60_000);
    window.dispatchEvent(new StorageEvent('storage', { key: LAST_ACTIVITY_KEY, newValue: String(Date.now()) }));
    vi.advanceTimersByTime(4 * 60_000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('local activity is broadcast to other tabs', () => {
    render(<IdleTimer timeoutMinutes={5} onIdle={vi.fn()} />);
    window.localStorage.removeItem(LAST_ACTIVITY_KEY);
    fireEvent.keyDown(window);
    expect(window.localStorage.getItem(LAST_ACTIVITY_KEY)).not.toBeNull();
  });

  it('default idle sign-out only signs out this browser, not every device', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<IdleTimer timeoutMinutes={5} />);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(assign).toHaveBeenCalledWith('/login?reason=idle');
    vi.unstubAllGlobals();
  });

  it('tells the server about activity at most once a minute (server-side idle check)', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    render(<IdleTimer timeoutMinutes={5} onIdle={vi.fn()} />);
    fireEvent.keyDown(window);
    fireEvent.keyDown(window);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/activity', { method: 'POST' });
    vi.advanceTimersByTime(61_000);
    fireEvent.keyDown(window);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});

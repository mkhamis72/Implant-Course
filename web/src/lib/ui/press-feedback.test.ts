import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installPressFeedback, SETTLE_MS } from './press-feedback';

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('installPressFeedback', () => {
  let uninstall: () => void;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    document.body.innerHTML = `
      <form><input name="q"><button class="btn" id="save">Save</button><button class="btn" id="remove">Remove</button></form>
      <button type="button" class="btn" id="open">Open</button>`;
    document.querySelector('form')!.addEventListener('submit', (e) => e.preventDefault());
    uninstall = installPressFeedback(document);
  });
  afterEach(() => {
    uninstall();
    vi.useRealTimers();
  });
  const $ = (id: string) => document.getElementById(id) as HTMLButtonElement;

  it('marks the pressed button busy while its save disables it, and clears it once it is enabled again', async () => {
    $('save').click();
    $('save').disabled = true;
    $('remove').disabled = true; // the same pending state disables its neighbour
    await flush();
    expect($('save').dataset.pressed).toBe('');
    expect($('save').getAttribute('aria-busy')).toBe('true');
    expect($('remove').hasAttribute('data-pressed')).toBe(false);
    expect($('remove').hasAttribute('aria-busy')).toBe(false);

    $('save').disabled = false;
    await flush();
    expect($('save').hasAttribute('data-pressed')).toBe(false);
    expect($('save').hasAttribute('aria-busy')).toBe(false);
  });

  it('forgets a press that does not start a save', async () => {
    $('open').click();
    expect($('open').hasAttribute('data-pressed')).toBe(true);
    vi.advanceTimersByTime(SETTLE_MS);
    expect($('open').hasAttribute('data-pressed')).toBe(false);
    // Disabled later for another reason: no spinner.
    $('open').disabled = true;
    await flush();
    expect($('open').hasAttribute('aria-busy')).toBe(false);
  });

  it('a new press moves the mark to the new button', async () => {
    $('save').click();
    $('remove').click();
    expect($('save').hasAttribute('data-pressed')).toBe(false);
    expect($('remove').hasAttribute('data-pressed')).toBe(true);
  });

  it('marks the submitter when a form is submitted with Enter', async () => {
    document.querySelector('form')!.requestSubmit($('remove'));
    expect($('remove').hasAttribute('data-pressed')).toBe(true);
  });

  it('stops listening once uninstalled', () => {
    uninstall();
    $('save').click();
    expect($('save').hasAttribute('data-pressed')).toBe(false);
    uninstall = () => {};
  });
});

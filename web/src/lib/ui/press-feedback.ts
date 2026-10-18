/**
 * Saving feedback on the button that was pressed. Most buttons are written `disabled={pending}`, and a form's
 * pending state often disables several buttons at once; marking the pressed one (`data-pressed`) lets the CSS
 * show a spinner on that button only (`.btn[data-pressed]:disabled` in globals.css), with `aria-busy` while
 * it is disabled. No per-button code: a press that doesn't disable its button within SETTLE_MS is forgotten.
 */
export const SETTLE_MS = 300;

type Mark = { button: HTMLButtonElement; observer: MutationObserver; timer: ReturnType<typeof setTimeout> };

export function installPressFeedback(doc: Document): () => void {
  let mark: Mark | null = null;

  function clear() {
    if (!mark) return;
    mark.observer.disconnect();
    clearTimeout(mark.timer);
    mark.button.removeAttribute('data-pressed');
    mark.button.removeAttribute('aria-busy');
    mark = null;
  }

  function press(button: HTMLButtonElement) {
    clear();
    let wasDisabled = button.disabled;
    button.setAttribute('data-pressed', '');
    if (wasDisabled) button.setAttribute('aria-busy', 'true');
    const observer = new MutationObserver(() => {
      if (button.disabled) {
        wasDisabled = true;
        button.setAttribute('aria-busy', 'true');
      } else if (wasDisabled) {
        clear();
      }
    });
    observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
    const timer = setTimeout(() => {
      if (!wasDisabled && mark?.button === button) clear();
    }, SETTLE_MS);
    mark = { button, observer, timer };
  }

  const onClick = (e: Event) => {
    const button = (e.target as Element | null)?.closest?.('button');
    if (button instanceof HTMLButtonElement && !button.disabled) press(button);
  };
  // Enter in a field submits through the form's default button without a click on it.
  const onSubmit = (e: Event) => {
    const submitter = (e as SubmitEvent).submitter;
    if (submitter instanceof HTMLButtonElement && mark?.button !== submitter) press(submitter);
  };
  // iOS Safari only applies :active (the press effect) once the page listens for touches.
  const onTouch = () => {};

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('submit', onSubmit, true);
  doc.addEventListener('touchstart', onTouch, { passive: true });
  return () => {
    clear();
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('submit', onSubmit, true);
    doc.removeEventListener('touchstart', onTouch);
  };
}

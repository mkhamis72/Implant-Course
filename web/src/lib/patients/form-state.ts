/** Server-action state for forms that must keep the user's input after a failed save. */
export type FormState = { ok?: string; error?: string; values?: Record<string, string> };

export function failed(error: string, formData: FormData): FormState {
  const values: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === 'string') values[key] = value;
  });
  return { error, values };
}

export function valueOf(state: FormState, key: string, fallback: string | null | undefined): string {
  return state.values?.[key] ?? fallback ?? '';
}

export function checkedOf(state: FormState, key: string, fallback: boolean): boolean {
  return state.values ? state.values[key] === 'on' : fallback;
}

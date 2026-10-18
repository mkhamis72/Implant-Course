'use client';

import { useEffect } from 'react';
import { installPressFeedback } from '@/lib/ui/press-feedback';

/** Spinner on the button whose save is running (src/lib/ui/press-feedback.ts). Renders nothing. */
export function PressFeedback() {
  useEffect(() => installPressFeedback(document), []);
  return null;
}

import { formatTime } from '@/lib/format';

export function formatConflict(name: string | null, at: string | null): string {
  return `This record was changed by ${name || 'another user'}${at ? ` at ${formatTime(at)}` : ''}. Reload to see it.`;
}

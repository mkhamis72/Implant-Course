'use server';

import { setPasswordFromLink, type SetPasswordState } from '@/lib/auth/link-password';

export async function acceptInviteAction(_prev: SetPasswordState, formData: FormData): Promise<SetPasswordState> {
  return setPasswordFromLink('invite', formData);
}

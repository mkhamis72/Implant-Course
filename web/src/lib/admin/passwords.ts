import { randomBytes } from 'node:crypto';

/** A one-time password the admin hands over in person; the user changes it under Account security. */
export function temporaryPassword(): string {
  return randomBytes(12).toString('base64url');
}

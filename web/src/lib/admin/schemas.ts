import { z } from 'zod';

const role = z.enum(['admin', 'organizer']);

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'Enter a valid email address.' }),
  full_name: z.string().trim().min(2, { message: 'Enter the full name (at least 2 characters).' }).max(100),
  role,
});

export const setRoleSchema = z.object({ user_id: z.string().uuid(), role });

export const setActiveSchema = z.object({
  user_id: z.string().uuid(),
  active: z.enum(['true', 'false']).transform((v) => v === 'true'),
});

export const settingsSchema = z.object({
  expiry_alert_days: z.coerce
    .number()
    .int({ message: 'Expiry alert must be a whole number of days.' })
    .min(1, { message: 'Expiry alert must be between 1 and 365 days.' })
    .max(365, { message: 'Expiry alert must be between 1 and 365 days.' }),
  session_timeout_minutes: z.coerce
    .number()
    .int({ message: 'Session timeout must be a whole number of minutes.' })
    .min(5, { message: 'Session timeout must be between 5 and 480 minutes.' })
    .max(480, { message: 'Session timeout must be between 5 and 480 minutes.' }),
});

export type ActionState = { ok?: string; error?: string };

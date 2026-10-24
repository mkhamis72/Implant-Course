import { z } from 'zod';

const role = z.enum(['admin', 'organizer']);

export const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email({ message: 'Enter a valid email address.' }),
  full_name: z.string().trim().min(2, { message: 'Enter the full name (at least 2 characters).' }).max(100),
  role,
});

export const changeEmailSchema = z.object({
  user_id: z.string().uuid(),
  email: inviteSchema.shape.email.max(120, { message: 'Keep the email to 120 characters or fewer.' }),
});

export const editNameSchema = z.object({
  user_id: z.string().uuid(),
  full_name: z.string().trim().min(1, { message: 'Enter a name.' }).max(120, { message: 'Keep the name to 120 characters or fewer.' }),
});

export const setRoleSchema =z.object({ user_id: z.string().uuid(), role });

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

const levelField = z.enum(['none', 'view', 'edit']).transform((v) => (v === 'none' ? null : v));

/** The permission grid: one None/View/Edit radio group per panel. */
export const permissionsSchema = z
  .object({
    user_id: z.string().uuid(),
    perm_patients: levelField,
    perm_schedule: levelField,
    perm_courses: levelField,
    perm_checklists: levelField,
    perm_inventory: levelField,
    perm_delegates: levelField,
    perm_research: levelField,
  })
  .transform(({ user_id, ...rest }) => ({
    user_id,
    perms: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k.replace('perm_', ''), v])) as Record<string, 'view' | 'edit' | null>,
  }));

export type ActionState = { ok?: string; error?: string; password?: string };

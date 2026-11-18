import { z } from 'zod';
import { normaliseHost } from '@/lib/tenant/host';
import { MODULES } from '@/lib/modules/modules';

const slug = z.string().trim().regex(/^[a-z0-9-]{2,40}$/, { message: 'Use 2–40 lower-case letters, digits or hyphens.' });
const name = z.string().trim().min(2, { message: 'Enter the company name (2–120 characters).' }).max(120, { message: 'Enter the company name (2–120 characters).' });
const hosts = z.string().transform((raw, ctx) => {
  const parts = raw.split(/[\s,]+/).map((h) => h.trim()).filter(Boolean);
  if (!parts.length) {
    ctx.addIssue({ code: 'custom', message: 'Enter at least one address.' });
    return z.NEVER;
  }
  const out: string[] = [];
  for (const part of parts) {
    const host = normaliseHost(part);
    if (!host || part.includes('/')) {
      ctx.addIssue({ code: 'custom', message: `Not a valid address: ${part}` });
      return z.NEVER;
    }
    if (!out.includes(host)) out.push(host);
  }
  return out;
});
const reason = z.string().trim().min(3, { message: 'Give a reason (3–300 characters).' }).max(300, { message: 'Give a reason (3–300 characters).' });

export const updateSchema = z.object({ slug, name, hosts });
export const statusSchema = z
  .object({ slug, status: z.enum(['active', 'suspended']), reason, confirm: z.string().trim() })
  .refine((s) => s.confirm === s.slug, { message: 'Type the company’s slug to confirm.' });
const email = z.string().trim().toLowerCase().email({ message: 'Enter a valid email address.' });
const fullName = z.string().trim().min(2, { message: 'Enter the full name (at least 2 characters).' }).max(100);
export const firstAdminSchema = z.object({ slug, email, fullName });
/** Adding a company (part 5): no keys, the shared database's are used; the first admin comes with it. */
export const onboardSchema = z.object({ slug, name, hosts, email, fullName });

const kind = z.enum(['course_organizer', 'clinic']);
const checked = (v: unknown) => v === 'on';
const picked = (prefix: string) => (o: Record<string, unknown>) => MODULES.filter((m) => checked(o[`${prefix}_${m}`]));
const planName = z.string().trim().min(2, { message: 'Give a name (2–60 characters).' }).max(60, { message: 'Give a name (2–60 characters).' });
/** A plan: name, type and the modules ticked in the form (checkboxes `module_<name>`). */
export const planSchema = z
  .object({ id: z.string().uuid().optional().or(z.literal('').transform(() => undefined)), name: planName, kind })
  .loose()
  .transform((o) => ({ id: o.id, name: o.name, kind: o.kind, modules: picked('module')(o) }));
/** A company's type, plan and extra modules (checkboxes `extra_<name>`). */
export const companyPlanSchema = z
  .object({ slug, kind, plan_id: z.string().uuid({ message: 'Choose a plan for this type of company.' }) })
  .loose()
  .transform((o) => ({ slug: o.slug, kind: o.kind, plan_id: o.plan_id, extras: picked('extra')(o) }));

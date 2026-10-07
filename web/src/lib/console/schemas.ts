import { z } from 'zod';
import { normaliseHost } from '@/lib/tenant/host';

const slug = z.string().trim().regex(/^[a-z0-9-]{2,40}$/, { message: 'Use 2–40 lower-case letters, digits or hyphens.' });
const name = z.string().trim().min(2, { message: 'Enter the company name (2–120 characters).' }).max(120, { message: 'Enter the company name (2–120 characters).' });
const key = z.string().trim().min(20, { message: 'Paste the key.' });
const supabaseUrl = z.string().trim().refine(
  (v) => /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(v) || /^http:\/\/(127\.0\.0\.1|localhost):[0-9]{2,5}$/.test(v),
  { message: 'Enter the project URL, e.g. https://abcd.supabase.co' },
);
const databaseUrl = z.string().trim().regex(/^postgres(ql)?:\/\//, { message: 'Paste the session pooler URI.' });
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

export const registerSchema = z.object({ slug, name, hosts, supabaseUrl, anonKey: key, serviceRoleKey: key, databaseUrl });
export const updateSchema = z.object({ slug, name, hosts });
export const secretsSchema = z.object({ slug, supabaseUrl, anonKey: key, serviceRoleKey: key, databaseUrl });
export const statusSchema = z
  .object({ slug, status: z.enum(['active', 'suspended']), reason, confirm: z.string().trim() })
  .refine((s) => s.confirm === s.slug, { message: 'Type the company’s slug to confirm.' });
export const firstAdminSchema = z.object({
  slug,
  email: z.string().trim().toLowerCase().email({ message: 'Enter a valid email address.' }),
  fullName: z.string().trim().min(2, { message: 'Enter the full name (at least 2 characters).' }).max(100),
});

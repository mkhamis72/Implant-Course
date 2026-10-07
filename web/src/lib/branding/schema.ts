import { z } from 'zod';
import { NAV_COLOR_UNREADABLE, brandColorProblem, navInk, normaliseHex } from './colors';

const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v ?? null);
const NAME_MESSAGE = 'Enter a name of 2–60 characters.';

const color = (problem: (hex: string) => string | null) =>
  z.preprocess(
    blankToNull,
    z
      .string()
      .nullable()
      .transform((v, ctx) => {
        if (v === null) return null;
        const hex = normaliseHex(v);
        if (!hex) {
          ctx.addIssue({ code: 'custom', message: 'Enter a colour like #0f766e.' });
          return z.NEVER;
        }
        const message = problem(hex);
        if (message) {
          ctx.addIssue({ code: 'custom', message });
          return z.NEVER;
        }
        return hex;
      }),
  );

/** Admin → Settings → Branding. Null means "use the default". */
export const brandingSchema = z.object({
  name: z.preprocess(blankToNull, z.string().trim().min(2, { message: NAME_MESSAGE }).max(60, { message: NAME_MESSAGE }).nullable()),
  brand_color: color(brandColorProblem),
  nav_color: color((hex) => (navInk(hex) ? null : NAV_COLOR_UNREADABLE)),
});

import { z } from 'zod';

/** An empty form field ('', or absent) as null; any other value unchanged (no trimming). */
export const blankToNull = (v: unknown): unknown => (v === '' || v === undefined || v === null ? null : v);

/** An optional id from a form: a UUID, or null when the field is empty. */
export const optionalUuid = z.preprocess(blankToNull, z.string().uuid().nullable());

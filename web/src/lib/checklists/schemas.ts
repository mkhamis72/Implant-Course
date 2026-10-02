import { z } from 'zod';
import { isRealDate } from '@/lib/dates';
import { parseChecklistText } from './parse';
import { SCOPES } from './types';

const blankToNull = (v: unknown) => (v === '' || v === undefined || v === null ? null : v);
const optionalId = z.preprocess(blankToNull, z.string().uuid().nullable());

function itemsField(required: boolean, emptyMessage: string) {
  return z
    .string()
    .default('')
    .transform((v, ctx) => {
      const items = parseChecklistText(v);
      if (required && items.length === 0) ctx.addIssue({ code: 'custom', message: emptyMessage });
      if (items.length > 200) ctx.addIssue({ code: 'custom', message: 'A checklist can have at most 200 items.' });
      if (items.some((i) => i.length > 300)) ctx.addIssue({ code: 'custom', message: 'Each item can be at most 300 characters.' });
      return items;
    });
}

export const templateSchema = z.object({
  id: optionalId,
  name: z.string().trim().min(2, { message: 'Enter the template name (at least 2 characters).' }).max(120),
  applies_to: z.enum(SCOPES, { message: 'Choose what the template is for.' }),
  is_default: z.preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean()),
  items: itemsField(true, 'Add at least one item (one per line).'),
});

export const newChecklistSchema = z
  .object({
    title: z.string().trim().min(2, { message: 'Enter the checklist title (at least 2 characters).' }).max(120),
    items: itemsField(false, ''),
    template_id: optionalId,
  })
  .refine((c) => c.items.length > 0 || c.template_id !== null, {
    message: 'Add at least one item (one per line) or choose a template.',
  });

export const addItemsSchema = z.object({
  checklist_id: z.string().uuid(),
  items: itemsField(true, 'Add at least one item (one per line).'),
});

export const itemEditSchema = z.object({
  id: z.string().uuid(),
  text: z.string().trim().min(1, { message: 'The item cannot be empty.' }).max(300, { message: 'Each item can be at most 300 characters.' }),
  assignee_id: optionalId,
  due_date: z.preprocess(blankToNull, z.string().refine(isRealDate, { message: 'Enter a valid due date or leave it empty.' }).nullable()),
});

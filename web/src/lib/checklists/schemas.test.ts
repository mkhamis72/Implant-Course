import { describe, it, expect } from 'vitest';
import { addItemsSchema, newChecklistSchema, templateSchema } from './schemas';

const err = (r: { error?: { issues: { message: string }[] } }) => r.error?.issues[0].message;

describe('checklist schemas', () => {
  it('parses pasted items', () => {
    expect(templateSchema.parse({ name: ' Surgery ', applies_to: 'surgery_booking', is_default: 'on', items: '- A\n- B' })).toEqual({
      id: null, name: 'Surgery', applies_to: 'surgery_booking', is_default: true, items: ['A', 'B'],
    });
    expect(newChecklistSchema.parse({ title: 'Day 1', items: '1. Room', template_id: '' })).toEqual({
      title: 'Day 1', items: ['Room'], template_id: null,
    });
  });
  it('needs items unless a template is chosen', () => {
    expect(err(newChecklistSchema.safeParse({ title: 'Day 1', items: '  \n' }))).toBe('Add at least one item (one per line) or choose a template.');
    expect(newChecklistSchema.safeParse({ title: 'Day 1', items: '', template_id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427' }).success).toBe(true);
    expect(err(addItemsSchema.safeParse({ checklist_id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', items: '' }))).toBe(
      'Add at least one item (one per line).',
    );
  });
  it('enforces limits with clear messages', () => {
    expect(err(templateSchema.safeParse({ name: 'T', applies_to: 'general', items: 'a' }))).toBe('Enter the template name (at least 2 characters).');
    expect(err(templateSchema.safeParse({ name: 'Too long', applies_to: 'general', items: 'x'.repeat(301) }))).toBe(
      'Each item can be at most 300 characters.',
    );
    expect(err(templateSchema.safeParse({ name: 'Too many', applies_to: 'general', items: Array.from({ length: 201 }, (_, i) => `i${i}`).join('\n') }))).toBe(
      'A checklist can have at most 200 items.',
    );
  });
});

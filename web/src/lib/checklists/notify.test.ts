import { describe, it, expect } from 'vitest';
import { assignmentEmail, assignmentNotice, type ItemSnapshot } from './notify';

const before: ItemSnapshot = { text: 'Call the lab', assignee_id: null, due_date: null };

describe('assignmentNotice', () => {
  it('is "assigned" when the item gets a new assignee, or moves to someone else', () => {
    expect(assignmentNotice(before, { ...before, assignee_id: 'u2' }, 'u1')).toBe('assigned');
    expect(assignmentNotice({ ...before, assignee_id: 'u3' }, { ...before, assignee_id: 'u2' }, 'u1')).toBe('assigned');
  });

  it('is "changed" when the text or due date of an assigned item changes', () => {
    const assigned = { ...before, assignee_id: 'u2' };
    expect(assignmentNotice(assigned, { ...assigned, text: 'Call the lab today' }, 'u1')).toBe('changed');
    expect(assignmentNotice(assigned, { ...assigned, due_date: '2031-01-15' }, 'u1')).toBe('changed');
  });

  it('is null with no assignee, a self-assignment, or nothing that matters changed', () => {
    expect(assignmentNotice(before, { ...before, text: 'Other' }, 'u1')).toBeNull();
    expect(assignmentNotice({ ...before, assignee_id: 'u2' }, before, 'u1')).toBeNull();
    expect(assignmentNotice(before, { ...before, assignee_id: 'u1' }, 'u1')).toBeNull();
    expect(assignmentNotice({ ...before, assignee_id: 'u2' }, { ...before, assignee_id: 'u2' }, 'u1')).toBeNull();
  });
});

describe('assignmentEmail', () => {
  const base = {
    company: 'Cairo Implant Academy',
    checklistTitle: 'Course <May>',
    item: { text: 'Order <b>screws</b> & drills', assignee_id: 'u2', due_date: '2031-01-15' },
    by: 'Dr Sara',
    link: 'https://academy.example/checklists/c1',
  };

  it('names the item, checklist, due date, who changed it and the link', () => {
    const e = assignmentEmail('assigned', base);
    expect(e.subject).toBe("Checklist: you've been assigned an item");
    for (const part of ['Cairo Implant Academy', 'Course <May>', 'Order <b>screws</b> & drills', 'Dr Sara', base.link]) {
      expect(e.text).toContain(part);
    }
    expect(e.text).toMatch(/Due: \S/);
  });

  it('escapes user text in the HTML part', () => {
    const e = assignmentEmail('assigned', base);
    expect(e.html).toContain('Order &lt;b&gt;screws&lt;/b&gt; &amp; drills');
    expect(e.html).toContain('Course &lt;May&gt;');
    expect(e.html).not.toContain('<b>screws</b>');
    expect(e.html).toContain(`href="${base.link}"`);
  });

  it('has its own subject for a change and leaves out a missing due date', () => {
    const e = assignmentEmail('changed', { ...base, item: { ...base.item, due_date: null } });
    expect(e.subject).toBe('Checklist: an item assigned to you changed');
    expect(e.text).not.toContain('Due:');
  });
});

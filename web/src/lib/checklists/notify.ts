import { formatDate } from '@/lib/format';

export type ItemSnapshot = { text: string; assignee_id: string | null; due_date: string | null };
export type Notice = 'assigned' | 'changed';

/** Whether an edit should email the item's assignee: never for no assignee or for the editor themselves. */
export function assignmentNotice(before: ItemSnapshot, after: ItemSnapshot, actorId: string): Notice | null {
  if (!after.assignee_id || after.assignee_id === actorId) return null;
  if (after.assignee_id !== before.assignee_id) return 'assigned';
  if (after.text !== before.text || after.due_date !== before.due_date) return 'changed';
  return null;
}

const SUBJECTS: Record<Notice, string> = {
  assigned: "Checklist: you've been assigned an item",
  changed: 'Checklist: an item assigned to you changed',
};

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function assignmentEmail(
  notice: Notice,
  a: { company: string; checklistTitle: string; item: ItemSnapshot; by: string; link: string },
): { subject: string; text: string; html: string } {
  const intro = notice === 'assigned' ? `${a.by} assigned you a checklist item.` : `${a.by} changed a checklist item assigned to you.`;
  const rows: [string, string][] = [
    ['Checklist', a.checklistTitle],
    ['Item', a.item.text],
    ...(a.item.due_date ? [['Due', formatDate(a.item.due_date)] as [string, string]] : []),
  ];
  const text = [a.company, '', intro, '', ...rows.map(([k, v]) => `${k}: ${v}`), '', `Open the checklist: ${a.link}`].join('\n');
  const html = [
    `<p style="color:#555">${escapeHtml(a.company)}</p>`,
    `<p>${escapeHtml(intro)}</p>`,
    `<table>${rows.map(([k, v]) => `<tr><td style="padding-right:12px;color:#555">${k}</td><td><strong>${escapeHtml(v)}</strong></td></tr>`).join('')}</table>`,
    `<p><a href="${escapeHtml(a.link)}">Open the checklist</a></p>`,
  ].join('\n');
  return { subject: SUBJECTS[notice], text, html };
}

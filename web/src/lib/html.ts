const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Text made safe to put inside HTML (email bodies, chart tooltips): the five HTML characters escaped. */
export const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (c) => ESCAPES[c]);

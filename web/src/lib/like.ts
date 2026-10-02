/** Escapes %, _ and \ so the text matches literally in a LIKE/ILIKE pattern. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

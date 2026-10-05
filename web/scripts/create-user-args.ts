export type Role = 'admin' | 'organizer' | 'delegate';
export type CreateUserArgs = { email: string; fullName: string; role: Role; delegateId?: string };

export const USAGE = 'Usage: npm run create-user -- <email> "<Full Name>" [--role organizer|admin|delegate --delegate <id>]';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCreateUserArgs(argv: string[]): CreateUserArgs | { error: string } {
  let role = 'organizer';
  let delegateId = '';
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--role') role = argv[++i] ?? '';
    else if (a.startsWith('--role=')) role = a.slice('--role='.length);
    else if (a === '--delegate') delegateId = argv[++i] ?? '';
    else if (a.startsWith('--delegate=')) delegateId = a.slice('--delegate='.length);
    else rest.push(a);
  }
  if (role !== 'admin' && role !== 'organizer' && role !== 'delegate') return { error: `Unknown role "${role}". Use organizer, admin or delegate.` };
  if (role === 'delegate' && !UUID.test(delegateId)) return { error: 'A delegate login needs --delegate <id>.' };
  const [rawEmail, ...nameParts] = rest;
  const email = (rawEmail ?? '').trim().toLowerCase();
  const fullName = nameParts.join(' ').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) return { error: USAGE };
  return role === 'delegate' ? { email, fullName, role, delegateId } : { email, fullName, role };
}

/** The Supabase host a script is about to change, printed first so dev and prod can't be confused. */
export function targetLabel(supabaseUrl: string | undefined): string {
  if (!supabaseUrl) return '(NEXT_PUBLIC_SUPABASE_URL not set)';
  return new URL(supabaseUrl).host;
}

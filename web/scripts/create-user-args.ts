export type Role = 'admin' | 'organizer';
export type CreateUserArgs = { email: string; fullName: string; role: Role };

export const USAGE = 'Usage: npm run create-user -- <email> "<Full Name>" [--role organizer|admin]';

export function parseCreateUserArgs(argv: string[]): CreateUserArgs | { error: string } {
  let role = 'organizer';
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--role') role = argv[++i] ?? '';
    else if (a.startsWith('--role=')) role = a.slice('--role='.length);
    else rest.push(a);
  }
  if (role !== 'admin' && role !== 'organizer') return { error: `Unknown role "${role}". Use organizer or admin.` };
  const [rawEmail, ...nameParts] = rest;
  const email = (rawEmail ?? '').trim().toLowerCase();
  const fullName = nameParts.join(' ').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) return { error: USAGE };
  return { email, fullName, role };
}

/** The Supabase host a script is about to change, printed first so dev and prod can't be confused. */
export function targetLabel(supabaseUrl: string | undefined): string {
  if (!supabaseUrl) return '(NEXT_PUBLIC_SUPABASE_URL not set)';
  return new URL(supabaseUrl).host;
}

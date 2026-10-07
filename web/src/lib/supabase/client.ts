import { createBrowserClient } from '@supabase/ssr';

/** Browser client for the current company: its URL and public key come from the server-rendered layout. */
export function createClient(url: string, anonKey: string) {
  return createBrowserClient(url, anonKey);
}

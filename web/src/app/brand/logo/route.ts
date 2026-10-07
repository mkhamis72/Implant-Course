import { createClient } from '@/lib/supabase/server';
import { decodeBytea } from '@/lib/branding/image';

/** The current company's logo. Versioned URLs (?v=) change on every upload, so they can be cached for a year. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('branding_logo').maybeSingle<{ bytes: string; content_type: string }>();
  if (error || !data) return new Response(null, { status: 404 });
  const versioned = new URL(request.url).searchParams.has('v');
  return new Response(Buffer.from(decodeBytea(data.bytes)), {
    headers: {
      'Content-Type': data.content_type,
      'Cache-Control': versioned ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  });
}

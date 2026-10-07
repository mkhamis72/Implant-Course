import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { decodeBytea } from '@/lib/branding/image';

/** The current company's logo. Versioned URLs (?v=) change on every upload, so the browser may keep them for a year (private: the response can carry a session cookie). */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('branding_logo').maybeSingle<{ bytes: string; content_type: string }>();
    if (error || !data) return new Response(null, { status: 404 });
    const versioned = new URL(request.url).searchParams.has('v');
    return new Response(Buffer.from(decodeBytea(data.bytes)), {
      headers: {
        'Content-Type': data.content_type,
        'Cache-Control': versioned ? 'private, max-age=31536000, immutable' : 'no-cache',
      },
    });
  } catch (e) {
    unstable_rethrow(e);
    return new Response(null, { status: 404 });
  }
}

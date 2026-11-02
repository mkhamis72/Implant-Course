import 'server-only';
import { cache } from 'react';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { currentTenant } from '@/lib/tenant/current';
import { DEFAULT_BRANDING, toBranding, type Branding, type BrandingRow } from './branding';

/** The current company's branding, read once per request. Never breaks a page: any failure → today's look. */
export const getBranding = cache(async (): Promise<Branding> => {
  try {
    const { companyId } = await currentTenant();
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('branding_for', { p_company: companyId }).maybeSingle<BrandingRow>();
    return error ? DEFAULT_BRANDING : toBranding(data);
  } catch (e) {
    unstable_rethrow(e); // Next's own signals (dynamic rendering, redirects) must pass through
    return DEFAULT_BRANDING;
  }
});

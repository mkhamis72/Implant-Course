'use client';

import { useActionState, useId, useState } from 'react';
import Image from 'next/image';
import { DEFAULT_NAME, type Branding } from '@/lib/branding/branding';
import { DEFAULT_ACCENT, INK, NAV_COLOR_UNREADABLE, WHITE, brandColorProblem, navInk, normaliseHex } from '@/lib/branding/colors';
import { MAX_LOGO_BYTES } from '@/lib/branding/image';
import { valueOf, type FormState } from '@/lib/patients/form-state';
import { brandingAction } from './actions';

function ColorField(p: { name: string; label: string; value: string; onChange: (v: string) => void; fallback: string; problem: string | null }) {
  const hex = normaliseHex(p.value);
  const id = useId();
  return (
    <div className="space-y-1">
      <label className="label" htmlFor={id}>{p.label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-hidden="true"
          tabIndex={-1}
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-line-strong bg-surface"
          value={hex ?? p.fallback}
          onChange={(e) => p.onChange(e.target.value)}
        />
        <input id={id} className="input" name={p.name} value={p.value} placeholder={`Default (${p.fallback})`} onChange={(e) => p.onChange(e.target.value)} />
      </div>
      {p.problem && <p className="text-sm text-bad">{p.problem}</p>}
    </div>
  );
}

/** Name, colours and logo of this company; blank fields use today's defaults. */
export function BrandingForm({ branding }: { branding: Branding }) {
  const [state, action, pending] = useActionState<FormState, FormData>(brandingAction, {});
  const [brand, setBrand] = useState(branding.brandColor ?? '');
  const [nav, setNav] = useState(branding.navColor ?? '');
  // Follow the saved colours when they change (after a save or reset) without remounting,
  // so the status message survives: adjust state during render, not in an effect.
  const [synced, setSynced] = useState({ brand: branding.brandColor, nav: branding.navColor });
  if (synced.brand !== branding.brandColor || synced.nav !== branding.navColor) {
    setSynced({ brand: branding.brandColor, nav: branding.navColor });
    setBrand(branding.brandColor ?? '');
    setNav(branding.navColor ?? '');
  }
  const [fileError, setFileError] = useState<string | null>(null);

  const brandHex = normaliseHex(brand);
  const navHex = normaliseHex(nav);
  const brandProblem = brandHex ? brandColorProblem(brandHex) : null;
  const navText = navHex ? navInk(navHex) : null;
  const navProblem = navHex && !navText ? NAV_COLOR_UNREADABLE : null;
  const previewAccent = brandHex && !brandProblem ? brandHex : DEFAULT_ACCENT;
  const message = fileError ?? state.error;
  const ok = state.ok;

  return (
    <div className="card max-w-xl space-y-4">
      <form action={action} className="space-y-4" key={branding.logoUrl ?? 'no-logo'}>
        <label className="block">
          <span className="label">Name</span>
          <input className="input" name="name" defaultValue={valueOf(state, 'name', branding.name === DEFAULT_NAME ? '' : branding.name)} placeholder={DEFAULT_NAME} />
        </label>
        <ColorField name="brand_color" label="Brand colour" value={brand} onChange={setBrand} fallback={DEFAULT_ACCENT} problem={brandProblem} />
        <ColorField name="nav_color" label="Navigation colour" value={nav} onChange={setNav} fallback={WHITE} problem={navProblem} />
        <div aria-hidden="true" className="flex items-center gap-3 rounded-md border border-line p-3 text-sm"
          style={{ background: navHex && navText ? navHex : WHITE, color: navText ?? INK }}>
          <span className="font-semibold">Preview</span>
          <span className="rounded px-2 py-1 text-white" style={{ background: previewAccent }}>Button</span>
          <span className="underline" style={{ color: navHex && navText ? navText : previewAccent }}>Link</span>
        </div>
        <label className="block">
          <span className="label">Logo (PNG, JPEG or WebP, up to 200 KB)</span>
          <input
            className="input"
            type="file"
            name="logo"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && file.size > MAX_LOGO_BYTES) {
                setFileError('The logo must be 200 KB or smaller.');
                e.target.value = '';
              } else setFileError(null);
            }}
          />
        </label>
        {branding.logoUrl && (
          <Image src={branding.logoUrl} alt="Current logo" width={48} height={48} unoptimized className="h-12 w-12 object-contain" />
        )}
        {message && <p role="alert" className="text-sm text-bad">{message}</p>}
        {ok && !message && <p role="status" className="text-sm text-ok">{ok}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn" name="intent" value="save" disabled={pending}>Save branding</button>
          {branding.logoUrl && (
            <button className="btn-secondary btn" name="intent" value="remove" disabled={pending}>Remove logo</button>
          )}
          <button className="btn-secondary btn" name="intent" value="reset" disabled={pending}>Reset to defaults</button>
        </div>
      </form>
    </div>
  );
}

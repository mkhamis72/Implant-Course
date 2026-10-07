import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { getBranding } from '@/lib/branding/get';
import { brandingCss } from '@/lib/branding/css';
import { DEFAULT_ACCENT } from '@/lib/branding/colors';
import './globals.css';

// Self-hosted at build time; no request to Google at runtime.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export async function generateMetadata(): Promise<Metadata> {
  const branding = await getBranding();
  return {
    title: branding.name,
    description: 'Patients, implants, inventory and courses for implant-course organizers',
    ...(branding.logoUrl ? { icons: { icon: branding.logoUrl } } : {}),
  };
}

export async function generateViewport(): Promise<Viewport> {
  const branding = await getBranding();
  return { width: 'device-width', initialScale: 1, themeColor: branding.brandColor ?? DEFAULT_ACCENT };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The company's colours as CSS variables; brandingCss only lets validated hex colours through.
  const css = brandingCss(await getBranding());
  return (
    <html lang="en" className={inter.variable}>
      <head>{css ? <style>{css}</style> : null}</head>
      <body>{children}</body>
    </html>
  );
}

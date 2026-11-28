import { createElement, type ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';
import type { PassportModel } from './model';

export const PASSPORT_FAILED = 'Could not generate the passport. Please try again.';

/** A message meant for the user (the data route's own), shown as it is. */
class PassportError extends Error {}

/**
 * Builds the patient's Implant Passport in the browser and downloads it: the data route hands out the model (and
 * logs the generation), then react-pdf, the document and the fonts are loaded on this first use only (about 0.5 MB
 * gzipped, kept out of the page's bundle), the PDF is drawn to a Blob and saved through an `<a download>`.
 * Throws an Error whose message can be shown: the route's own, or PASSPORT_FAILED.
 */
export async function downloadPassport(patientId: string): Promise<void> {
  let body: { passport?: PassportModel; fileName?: string; error?: string } = {};
  try {
    const res = await fetch(`/patients/${patientId}/passport/data`, { cache: 'no-store', headers: { Accept: 'application/json' } });
    body = await res.json().catch(() => ({}));
    if (!res.ok || !body.passport || !body.fileName) throw new PassportError(body.error || PASSPORT_FAILED);

    const [{ pdf }, { PassportDocument }, { registerPassportFonts }] = await Promise.all([
      import('@react-pdf/renderer'), import('./document'), import('./fonts'),
    ]);
    registerPassportFonts();
    // PassportDocument returns a <Document>, which pdf()'s typing asks for directly.
    const doc = createElement(PassportDocument, { model: body.passport }) as unknown as ReactElement<DocumentProps>;
    const blob = await pdf(doc).toBlob();

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = body.fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked a little later: revoking at once can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  } catch (e) {
    if (e instanceof PassportError) throw e;
    console.error('Implant passport could not be built in the browser', e instanceof Error ? e.message : e);
    throw new Error(PASSPORT_FAILED);
  }
}

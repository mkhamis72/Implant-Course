import { createElement, type ReactElement } from 'react';
import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { registerPassportFonts } from './fonts';
import { PassportDocument } from './document';
import type { PassportModel } from './model';

/** The passport's PDF bytes (starting with %PDF-). Fonts come from the app; nothing is fetched. */
export async function renderPassport(model: PassportModel): Promise<Buffer> {
  registerPassportFonts();
  // PassportDocument returns a <Document>, which renderToBuffer's typing asks for directly.
  const doc = createElement(PassportDocument, { model }) as unknown as ReactElement<DocumentProps>;
  return renderToBuffer(doc);
}

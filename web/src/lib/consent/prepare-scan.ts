import { JPEG_QUALITY, fitWithin } from './files';

const RESIZABLE = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Browser only. A photo becomes a JPEG at most 2000 px on its longest side; PDFs (and anything the server will
 * refuse) pass through. `fallbackName` names the JPEG when the file's own name is empty.
 */
export async function prepareScan(file: File, fallbackName = 'scan'): Promise<File> {
  if (!RESIZABLE.includes(file.type)) return file;
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { w, h } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  // A transparent PNG would turn black as JPEG: paper is white.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Could not encode');
  return new File([blob], `${file.name.replace(/\.[^.]*$/, '') || fallbackName}.jpg`, { type: 'image/jpeg' });
}

// Shrinks large photos before upload; PDFs, screenshots and small images are kept as they are.

const SHRINK_ABOVE = 2 * 1024 * 1024; // bytes
const MAX_SIDE = 2200; // px – keeps receipts readable
const QUALITY = 0.82;

export interface PreparedFile {
  blob: Blob;
  name: string;
  shrunk: boolean;
  originalSize: number;
}

export async function prepareReceipt(file: File): Promise<PreparedFile> {
  const keep = { blob: file as Blob, name: file.name || 'potvrda', shrunk: false, originalSize: file.size };
  if (!file.type.startsWith('image/') || file.size <= SHRINK_ABOVE) return keep;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return keep; // e.g. HEIC in browsers that cannot decode it – upload the original
  }
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const g = canvas.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', QUALITY));
    if (!blob || blob.size >= file.size) return keep;
    return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg', shrunk: true, originalSize: file.size };
  } finally {
    bmp.close();
  }
}

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

export const ACCEPT_RECEIPTS = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif';

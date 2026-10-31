// Reads a PDF417 barcode from an image or PDF (entirely in the browser)
import {
  BinaryBitmap, DecodeHintType, GlobalHistogramBinarizer, HybridBinarizer,
  PDF417Reader, RGBLuminanceSource, ZXingStringEncoding,
} from '@zxing/library';

// HUB-3 is UTF-8; zxing would otherwise decode bytes as latin1
ZXingStringEncoding.customDecoder = (bytes: Uint8Array) => {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1250').decode(bytes); }
};

const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);

function lumaOf(img: ImageData): Uint8ClampedArray {
  const { data, width, height } = img;
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const a = data[i + 3] / 255; // transparent = white
    out[j] = ((data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000) * a + 255 * (1 - a);
  }
  return out;
}

function tryDecode(canvas: HTMLCanvasElement): string | null {
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  const luma = lumaOf(g.getImageData(0, 0, canvas.width, canvas.height));
  for (const Bin of [HybridBinarizer, GlobalHistogramBinarizer]) {
    try {
      const src = new RGBLuminanceSource(luma, canvas.width, canvas.height);
      return new PDF417Reader().decode(new BinaryBitmap(new Bin(src)), hints).getText();
    } catch { /* try next */ }
  }
  return null;
}

function draw(src: CanvasImageSource, w: number, h: number, scale: number, rotate = 0): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const sw = Math.round(w * scale), sh = Math.round(h * scale);
  const rot = rotate % 180 !== 0;
  c.width = rot ? sh : sw;
  c.height = rot ? sw : sh;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.translate(c.width / 2, c.height / 2);
  g.rotate((rotate * Math.PI) / 180);
  g.imageSmoothingEnabled = scale < 1;
  g.drawImage(src, -sw / 2, -sh / 2, sw, sh);
  return c;
}

/** Tries several scales and rotations – photos and screenshots differ a lot. */
function decodeSource(src: CanvasImageSource, w: number, h: number): string | null {
  const longest = Math.max(w, h);
  const scales = [1, 1600 / longest, 2400 / longest, 0.5].filter((s, i, a) => s > 0.2 && s <= 4 && a.indexOf(s) === i);
  for (const rot of [0, 90]) for (const s of scales) {
    const r = tryDecode(draw(src, w, h, s, rot));
    if (r) return r;
  }
  return null;
}

export async function decodeImageFile(file: Blob): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  try { return decodeSource(bmp, bmp.width, bmp.height); } finally { bmp.close(); }
}

let pdfjsPromise: Promise<any> | null = null;
export async function loadPdfJs() {
  if (!pdfjsPromise) pdfjsPromise = (async () => {
    const lib = (await import('pdfjs-dist/build/pdf.min.mjs')) as any;
    // @ts-ignore – esbuild loads the worker as text
    const workerCode: string = (await import('pdfjs-worker-text')).default;
    lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([workerCode], { type: 'text/javascript' }));
    return lib;
  })();
  return pdfjsPromise;
}

export async function decodePdfFile(file: Blob, onPage?: (n: number, total: number) => void): Promise<string | null> {
  const lib = await loadPdfJs();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const doc = await task.promise;
  try {
    const total = Math.min(doc.numPages, 10);
    for (let n = 1; n <= total; n++) {
      onPage?.(n, total);
      const page = await doc.getPage(n);
      for (const scale of [3, 4.5, 2]) {
        const vp = page.getViewport({ scale });
        const c = document.createElement('canvas');
        c.width = Math.ceil(vp.width);
        c.height = Math.ceil(vp.height);
        await page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp, background: '#ffffff' } as any).promise;
        const r = tryDecode(c) ?? decodeSource(c, c.width, c.height);
        if (r) return r;
      }
    }
    return null;
  } finally {
    try { await task.destroy?.(); } catch { /* */ }
  }
}

export async function decodeFile(file: File, onPage?: (n: number, total: number) => void): Promise<string | null> {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? decodePdfFile(file, onPage) : decodeImageFile(file);
}

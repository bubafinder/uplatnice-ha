// PDF417 per the HUB-3A spec: 9 data columns, error correction level 4, row ratio 3:1
// @ts-ignore – vendored bwip-js
import { rawPdf417 } from '../vendor/bwip.mjs';

export interface Matrix {
  cols: number; // width in modules (without quiet zone)
  rows: number; // number of symbol rows
  bits: Uint8Array; // rows * cols, 1 = black
}

export const MODULE_MM = 0.254;
export const ROW_MULT = 3; // row height = 3 modules
export const QUIET = 2; // quiet zone in modules (spec: at least 2)

export function pdf417Matrix(text: string): Matrix {
  const r = rawPdf417({ bcid: 'pdf417', text, columns: 9, eclevel: 4, rowmult: ROW_MULT });
  const cols: number = r.pixx;
  const bits = Uint8Array.from(r.pixs as number[]);
  return { cols, rows: bits.length / cols, bits };
}

/** Symbol width and height in mm, including the quiet zone. */
export function symbolSizeMm(m: Matrix) {
  return {
    w: (m.cols + 2 * QUIET) * MODULE_MM,
    h: (m.rows * ROW_MULT + 2 * QUIET) * MODULE_MM,
  };
}

/** Rectangles (in modules) – merges adjacent black modules within a row. */
export function runs(m: Matrix): { x: number; y: number; w: number }[] {
  const out: { x: number; y: number; w: number }[] = [];
  for (let y = 0; y < m.rows; y++) {
    let x = 0;
    while (x < m.cols) {
      if (m.bits[y * m.cols + x]) {
        const s = x;
        while (x < m.cols && m.bits[y * m.cols + x]) x++;
        out.push({ x: s, y, w: x - s });
      } else x++;
    }
  }
  return out;
}

/** SVG with quiet zone; unit = 1 module, row = 3 modules. */
export function matrixToSvg(m: Matrix, quiet = 4): string {
  const W = m.cols + 2 * quiet;
  const H = m.rows * ROW_MULT + 2 * quiet;
  let d = '';
  for (const r of runs(m)) d += `M${r.x + quiet} ${r.y * ROW_MULT + quiet}h${r.w}v${ROW_MULT}h-${r.w}z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" role="img" aria-label="PDF417 barkod uplatnice"><rect width="${W}" height="${H}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/** Draws onto a canvas with whole pixels per module (crisp for scanning and PNG). */
export function matrixToCanvas(m: Matrix, px = 4, quiet = 4): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = (m.cols + 2 * quiet) * px;
  c.height = (m.rows * ROW_MULT + 2 * quiet) * px;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#000';
  for (const r of runs(m)) g.fillRect((r.x + quiet) * px, (r.y * ROW_MULT + quiet) * px, r.w * px, ROW_MULT * px);
  return c;
}

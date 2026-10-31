// Generates barcodes (typical and maximum size) and decodes them with zxing
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pdf417Matrix, symbolSizeMm, ROW_MULT } from '../src/web/lib/barcode';
import { buildHub3 } from '../src/shared/hub3';
import type { Slip } from '../src/shared/types';

const require = createRequire(import.meta.url);
// ZXING_PATH lets offline environments point at a local build of @zxing/library
const Z = require(process.env.ZXING_PATH ?? '@zxing/library');
Z.ZXingStringEncoding.customDecoder = (b: Uint8Array) => Buffer.from(b).toString('utf8');

function decode(text: string) {
  const m = pdf417Matrix(text);
  const px = 3, q = 4;
  const W = (m.cols + 2 * q) * px, H = (m.rows * ROW_MULT + 2 * q) * px;
  const lum = new Uint8ClampedArray(W * H).fill(255);
  for (let y = 0; y < m.rows; y++) for (let x = 0; x < m.cols; x++) if (m.bits[y * m.cols + x])
    for (let dy = 0; dy < ROW_MULT * px; dy++) for (let dx = 0; dx < px; dx++)
      lum[((y * ROW_MULT + q) * px + dy) * W + (x + q) * px + dx] = 0;
  const bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, W, H)));
  return { m, text: new Z.PDF417Reader().decode(bmp).getText() as string };
}

const base: Slip = {
  amountCents: 2500,
  payer: { name: 'Ivan Horvat', street: 'Ilica 1', city: '10000 Zagreb' },
  payee: { name: 'NK Mladost', street: 'Sportska 5', city: '21000 Split', iban: 'HR1210010051863000160' },
  model: 'HR00', reference: '2026-11', purpose: 'OTHR', description: 'Članarina studeni 2026',
};

test('typical slip: 9 columns, within 58 x 26 mm, decodes exactly', () => {
  const t = buildHub3(base);
  const { m, text } = decode(t);
  assert.equal(text, t);
  assert.equal(m.cols, 17 * 13 + 1); // start + left indicator + 9 data + right indicator + stop
  const s = symbolSizeMm(m);
  assert.ok(s.w <= 58 && s.h <= 26, JSON.stringify(s));
});

test('maximum content (all Croatian letters, full length) decodes and fits the PDF field (38 mm)', () => {
  const Ž = (n: number) => 'ŽĆČŠĐžćčšđ'.repeat(5).slice(0, n);
  const max: Slip = {
    amountCents: 99999999999999,
    payer: { name: Ž(30), street: Ž(27), city: Ž(27) },
    payee: { name: Ž(25), street: Ž(25), city: Ž(27), iban: 'HR1210010051863000160' },
    model: 'HR00', reference: '123456789012-123456789', purpose: 'OTHR', description: Ž(35),
  };
  const t = buildHub3(max);
  const { m, text } = decode(t);
  assert.equal(text, t);
  const s = symbolSizeMm(m);
  console.log('max simbol', m.rows, 'redova,', s.w.toFixed(1), 'x', s.h.toFixed(1), 'mm');
  assert.ok(s.h <= 38, `visina ${s.h}`);
});

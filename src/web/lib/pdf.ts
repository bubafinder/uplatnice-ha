// A4 PDF with the HUB-3A slip (210 x 99 mm) at the bottom of the page
import { jsPDF } from 'jspdf';
// @ts-ignore – loaded as base64 by esbuild
import fontRegular from '../../../assets/fonts/DejaVuSans.sub.ttf';
// @ts-ignore
import fontBold from '../../../assets/fonts/DejaVuSans-Bold.sub.ttf';
import { formatAmount } from '../../shared/hub3';
import { formatIban } from '../../shared/iban';
import { PURPOSE_MAP } from '../../shared/purpose';
import type { Profile, Slip } from '../../shared/types';
import { MODULE_MM, QUIET, ROW_MULT, runs, type Matrix } from './barcode';

const RED: [number, number, number] = [184, 46, 62];
const INK: [number, number, number] = [20, 22, 28];
const GREY: [number, number, number] = [110, 114, 122];
const SLIP_Y = 198; // top edge of the slip on A4

export interface PdfInput {
  slip: Slip;
  matrix: Matrix;
  payerIban?: string;
  title?: string; // e.g. template name
}

export function buildPdf({ slip, matrix, payerIban, title }: PdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.addFileToVFS('DejaVuSans.ttf', fontRegular);
  doc.addFont('DejaVuSans.ttf', 'DejaVu', 'normal');
  doc.addFileToVFS('DejaVuSans-Bold.ttf', fontBold);
  doc.addFont('DejaVuSans-Bold.ttf', 'DejaVu', 'bold');
  doc.setProperties({ title: `Uplatnica – ${slip.payee.name}`, creator: 'Uplatnice (HUB-3A)' });

  const amount = formatAmount(slip.amountCents);
  const font = (size: number, bold = false, color = INK) => {
    doc.setFont('DejaVu', bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
  };

  // ---------- top of the page: summary ----------
  font(9, false, GREY);
  doc.text(title ? `Uplatnica · ${title}` : 'Uplatnica', 20, 24);
  font(20, true);
  doc.text(doc.splitTextToSize(slip.payee.name || 'Primatelj', 170), 20, 34);
  font(28, true);
  doc.text(`${amount} EUR`, 20, 52);
  font(11);
  const desc = slip.description ? doc.splitTextToSize(slip.description, 170) : [];
  doc.text(desc, 20, 62);

  const rows: [string, string][] = [
    ['IBAN primatelja', formatIban(slip.payee.iban)],
    ['Model i poziv na broj', [slip.model, slip.reference].filter(Boolean).join(' ')],
    ['Šifra namjene', `${slip.purpose}${PURPOSE_MAP.get(slip.purpose) ? ' – ' + PURPOSE_MAP.get(slip.purpose)!.label : ''}`],
    ['Platitelj', [slip.payer.name, slip.payer.street, slip.payer.city].filter(Boolean).join(', ')],
  ];
  let y = 62 + desc.length * 5 + 8;
  for (const [k, v] of rows) {
    font(9, false, GREY);
    doc.text(k, 20, y);
    font(10.5);
    doc.text(doc.splitTextToSize(v || '–', 125), 65, y);
    y += 8;
  }
  font(8.5, false, GREY);
  doc.text(
    'Barkod u lijevom donjem kutu uplatnice možeš skenirati mobilnim bankarstvom. Za plaćanje u banci ili pošti odreži uplatnicu po crtkanoj liniji.',
    20, 182, { maxWidth: 170 },
  );

  // ---------- cut line ----------
  doc.setDrawColor(...GREY);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1.5, 1.2], 0);
  doc.line(0, SLIP_Y, 210, SLIP_Y);
  doc.line(150, SLIP_Y, 150, 297); // order | receipt
  doc.setLineDashPattern([], 0);
  font(7, false, GREY);
  doc.text('✂', 6, SLIP_Y - 1.2);

  // ---------- HUB-3A form ----------
  const Y = (v: number) => SLIP_Y + v;
  const box = (x: number, yy: number, w: number, h: number, label: string, value?: string | string[], opts: { bold?: boolean; right?: boolean; size?: number } = {}) => {
    doc.setDrawColor(...RED);
    doc.setLineWidth(0.25);
    doc.rect(x, Y(yy), w, h);
    font(5.2, false, RED);
    doc.text(label, x + 1, Y(yy) + 2.2);
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) return;
    const size = opts.size ?? 8;
    font(size, opts.bold);
    const lines = Array.isArray(value) ? value : [value];
    lines.forEach((ln, i) => {
      if (opts.right) doc.text(ln, x + w - 1.5, Y(yy) + 5.6 + i * size * 0.42, { align: 'right' });
      else doc.text(ln, x + 1.5, Y(yy) + 5.6 + i * size * 0.42);
    });
  };
  const fit = (text: string, width: number, size: number) => {
    font(size);
    return doc.splitTextToSize(text, width) as string[];
  };

  font(8, true, RED);
  doc.text('NALOG ZA PLAĆANJE', 4, Y(5.6));
  font(7, true, RED);
  doc.text('HUB-3A', 146, Y(5.6), { align: 'right' });
  doc.text('POTVRDA ZA PLATITELJA', 154, Y(5.6));

  // left column
  const party = (p: { name: string; street: string; city: string }) => [p.name, p.street, p.city].filter(Boolean);
  box(4, 8, 62, 21, 'PLATITELJ (naziv/ime i adresa)', party(slip.payer), { size: 8 });
  box(4, 32, 62, 21, 'PRIMATELJ (naziv/ime i adresa)', party(slip.payee), { size: 8, bold: false });

  // barcode field; barcode is 1 mm from the field's left and top edges (spec)
  const fieldY = 56;
  doc.setDrawColor(...RED);
  doc.setLineWidth(0.25);
  doc.rect(4, Y(fieldY), 62, 41);
  const bx = 4 + 1 + QUIET * MODULE_MM;
  const by = Y(fieldY) + 1 + QUIET * MODULE_MM;
  doc.setFillColor(0, 0, 0);
  for (const r of runs(matrix)) {
    doc.rect(bx + r.x * MODULE_MM, by + r.y * ROW_MULT * MODULE_MM, r.w * MODULE_MM, ROW_MULT * MODULE_MM, 'F');
  }

  // middle column
  box(70, 8, 22, 8, 'Valuta plaćanja', 'EUR', { bold: true });
  box(95, 8, 51, 8, 'Iznos', `=${amount}`, { bold: true, right: true, size: 9 });
  box(70, 19, 76, 8, 'IBAN ili broj računa platitelja', payerIban ? formatIban(payerIban) : '');
  box(70, 30, 15, 8, 'Model', '');
  box(88, 30, 58, 8, 'Poziv na broj platitelja', '');
  box(70, 41, 76, 8, 'IBAN ili broj računa primatelja', formatIban(slip.payee.iban), { bold: true });
  box(70, 52, 15, 8, 'Model', slip.model);
  box(88, 52, 58, 8, 'Poziv na broj primatelja', slip.reference);
  box(70, 63, 15, 10, 'Šifra namjene', slip.purpose);
  box(88, 63, 58, 10, 'Opis plaćanja', fit(slip.description, 55, 8).slice(0, 2));
  box(70, 76, 32, 8, 'Datum izvršenja', '');
  box(70, 87, 37, 10, 'Pečat korisnika PU', '');
  box(110, 87, 36, 10, 'Potpis korisnika PU', '');

  // receipt part
  box(154, 8, 52, 8, 'Iznos', `EUR =${amount}`, { bold: true, right: true });
  box(154, 19, 52, 8, 'IBAN ili broj računa platitelja', payerIban ? formatIban(payerIban) : '', { size: 7 });
  box(154, 30, 52, 8, 'IBAN ili broj računa primatelja', formatIban(slip.payee.iban), { size: 7 });
  box(154, 41, 52, 8, 'Model i poziv na broj primatelja', [slip.model, slip.reference].filter(Boolean).join(' '), { size: 7 });
  box(154, 52, 52, 10, 'Opis plaćanja', fit(slip.description, 49, 7).slice(0, 2), { size: 7 });
  box(154, 65, 52, 8, 'Primatelj', fit(slip.payee.name, 49, 7).slice(0, 1), { size: 7 });
  box(154, 76, 52, 21, 'Pečat korisnika PU', '');

  return doc;
}

export function pdfFileName(slip: Slip): string {
  const base = (slip.payee.name || 'uplatnica')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `uplatnica-${base || 'hub3'}-${formatAmount(slip.amountCents).replace(/[.,]/g, '')}.pdf`;
}

export type { Profile };

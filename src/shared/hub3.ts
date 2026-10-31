// Building, validating and parsing HUB-3A payload (HRVHUB30)
import { ibanError, normalizeIban } from './iban';
import { referenceError } from './reference';
import { charLength, invalidChars, MAX, sanitize } from './text';
import type { FieldKey, Issue, Slip } from './types';

export const HEADER = 'HRVHUB30';
export const CURRENCY = 'EUR';
export const MAX_CENTS = 999_999_999_999_99; // 15 digits

/** "1.234,56" / "1234,56" / "1234.56" → cents; null if not a number. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s €]|EUR/gi, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return null;
  const [i, f = ''] = s.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
}

/** Cents → "1.234,56" */
export function formatAmount(cents: number | null): string {
  if (cents === null) return '';
  const e = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${e},${String(cents % 100).padStart(2, '0')}`;
}

const TEXT_FIELDS: [FieldKey, (s: Slip) => string, string][] = [
  ['payer.name', s => s.payer.name, 'Ime platitelja'],
  ['payer.street', s => s.payer.street, 'Adresa platitelja'],
  ['payer.city', s => s.payer.city, 'Mjesto platitelja'],
  ['payee.name', s => s.payee.name, 'Naziv primatelja'],
  ['payee.street', s => s.payee.street, 'Adresa primatelja'],
  ['payee.city', s => s.payee.city, 'Mjesto primatelja'],
  ['description', s => s.description, 'Opis plaćanja'],
];

/** All checks before generating the barcode. Errors block generation, warnings do not. */
export function validate(s: Slip): Issue[] {
  const out: Issue[] = [];
  const err = (field: FieldKey, message: string) => out.push({ field, level: 'error', message });
  const warn = (field: FieldKey, message: string) => out.push({ field, level: 'warning', message });

  if (s.amountCents === null) err('amount', 'Upiši iznos, npr. 25,00.');
  else if (s.amountCents <= 0) err('amount', 'Iznos mora biti veći od nule.');
  else if (s.amountCents > MAX_CENTS) err('amount', 'Iznos je prevelik.');

  for (const [key, get, label] of TEXT_FIELDS) {
    const v = get(s);
    const bad = invalidChars(v);
    if (bad.length) err(key, `${label} sadrži nedozvoljene znakove: ${bad.map(c => `„${c}"`).join(' ')}`);
    const n = charLength(v);
    const max = MAX[key as keyof typeof MAX];
    if (n > max) err(key, `${label} ima ${n} znakova, a smije najviše ${max}.`);
  }
  if (!s.payee.name.trim()) err('payee.name', 'Upiši naziv primatelja.');
  if (!s.payer.name.trim()) warn('payer.name', 'Platitelj nije upisan. Barkod će raditi, ali je bolje upisati ime.');
  if (!s.description.trim()) warn('description', 'Opis plaćanja je prazan.');

  const ie = ibanError(s.payee.iban);
  if (ie) err('payee.iban', ie);

  const re = referenceError(s.model, s.reference);
  if (re) {
    // unknown model or bad format is an error; a wrong check digit is only a warning
    if (/Kontrolni broj/.test(re)) warn('reference', re + ' Provjeri broj na računu.');
    else err(/model/i.test(re) && !s.reference ? 'model' : 'reference', re);
  }

  if (!/^[A-Z]{4}$/.test(s.purpose.trim().toUpperCase())) err('purpose', 'Šifra namjene ima točno 4 slova, npr. OTHR.');
  return out;
}

export const hasErrors = (issues: Issue[]) => issues.some(i => i.level === 'error');

/** Builds the PDF417 payload. Assumes validate() passed. */
export function buildHub3(s: Slip): string {
  const ref = s.reference.trim();
  const model = s.model.trim().toUpperCase() || (ref ? '' : 'HR99');
  const fields = [
    HEADER,
    CURRENCY,
    String(s.amountCents ?? 0).padStart(15, '0'),
    s.payer.name.trim(), s.payer.street.trim(), s.payer.city.trim(),
    s.payee.name.trim(), s.payee.street.trim(), s.payee.city.trim(),
    normalizeIban(s.payee.iban),
    model,
    ref,
    s.purpose.trim().toUpperCase(),
    s.description.trim(),
  ];
  return fields.join('\n') + '\n';
}

/** Parses a HUB-3 payload from a scanned barcode. Throws a user-facing error if it is not HUB-3. */
export function parseHub3(text: string): Slip {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!/^HRVHUB3/.test(lines[0] ?? '')) throw new Error('Ovo nije barkod hrvatske uplatnice (nedostaje zaglavlje HRVHUB30).');
  while (lines.length < 14) lines.push('');
  const [, currency, amount, pn, ps, pc, rn, rs, rc, iban, model, ref, purpose, desc] = lines.map(l => l.trim());
  if (currency && currency !== 'EUR') throw new Error(`Barkod je u valuti ${currency}. Podržane su samo uplatnice u eurima.`);
  const cents = /^\d+$/.test(amount) ? Number(amount) : null;
  const clip = (v: string, n: number) => [...sanitize(v)].slice(0, n).join('');
  return {
    amountCents: cents,
    payer: { name: clip(pn, MAX['payer.name']), street: clip(ps, MAX['payer.street']), city: clip(pc, MAX['payer.city']) },
    payee: { name: clip(rn, MAX['payee.name']), street: clip(rs, MAX['payee.street']), city: clip(rc, MAX['payee.city']), iban: normalizeIban(iban) },
    model: model.toUpperCase(),
    reference: ref,
    purpose: purpose.toUpperCase() || 'OTHR',
    description: clip(desc, MAX.description),
  };
}

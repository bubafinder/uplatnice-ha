// Parses a pasted list from notes, e.g. "11/25 - 40 aircash"
import { parseAmount } from './hub3';
import { parsePeriodInput } from './history';
import type { Currency } from './types';

export interface ParsedLine {
  raw: string;
  ok: boolean;
  period?: string; // YYYY-MM
  amountCents: number | null;
  currency: Currency;
  method?: string;
  note?: string;
  error?: string;
}

const METHOD_ALIASES: [RegExp, string][] = [
  [/^air\s*cash$/i, 'Aircash'],
  [/^m[-\s]?banking$|^mbank$|^mobilno$/i, 'mBanking'],
  [/^(e|internet)[-\s]?bankarstvo$|^net$|^online$/i, 'Internet bankarstvo'],
  [/^gotovina$|^ke[sš]$|^cash$/i, 'Gotovina'],
  [/^banka$|^po[sš]ta$|^fina$/i, 'Banka/pošta'],
  [/^trajni(\s+nalog)?$/i, 'Trajni nalog'],
];

function matchMethod(word: string, methods: string[]): string | undefined {
  const w = word.trim();
  if (!w) return undefined;
  for (const [re, name] of METHOD_ALIASES) if (re.test(w)) return name;
  return methods.find(m => m.toLowerCase() === w.toLowerCase());
}

const BULLET = /^\s*(?:[-*•·▪◦✓✔☑☐✅]|\[[ xX]\]|\d+[.)](?=\s))\s*/u;
const AMOUNT = /(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)\s*(eur|€|euro|eura|kn|kuna|hrk)?(?![\p{L}\d])/iu;

export function parseNotesLine(line: string, methods: string[]): ParsedLine | null {
  let s = line.replace(/ /g, ' ').trim();
  while (BULLET.test(s)) s = s.replace(BULLET, '');
  s = s.trim();
  if (!s) return null;
  const base: ParsedLine = { raw: line.trim(), ok: false, amountCents: null, currency: 'EUR' };

  // 1) leading period: "11/25", "2/22", "09/2024"
  let period: string | undefined;
  const pm = /^(\d{1,2}\s*[/.]\s*(?:\d{4}|\d{2}))(?!\d)\s*[-–:,]?\s*/.exec(s);
  if (pm) {
    const p = parsePeriodInput(pm[1]);
    if (p) { period = p; s = s.slice(pm[0].length); }
  }

  // 2) segments separated by a spaced dash
  const segs = s.split(/\s+[-–]\s+/).map(x => x.trim()).filter(Boolean);
  let amountIdx = -1;
  let am: RegExpExecArray | null = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const m = new RegExp('^' + AMOUNT.source, 'iu').exec(segs[i]);
    if (m) { amountIdx = i; am = m; break; }
  }
  if (!am) {
    // amount anywhere in the line (e.g. "2/22 66.33")
    const m = AMOUNT.exec(s);
    if (m && period) {
      segs.splice(0, segs.length, s.slice(0, m.index).trim(), s.slice(m.index).trim());
      amountIdx = 1;
      am = new RegExp('^' + AMOUNT.source, 'iu').exec(segs[1]);
    }
  }
  if (!am) return { ...base, period, error: 'Nije pronađen iznos.' };

  const cur = (am[2] ?? '').toLowerCase();
  const currency: Currency = /^(kn|kuna|hrk)$/.test(cur) ? 'HRK' : 'EUR';
  const amountCents = parseAmount(am[1]);
  if (amountCents === null) return { ...base, period, error: 'Iznos nije ispravan.' };

  // 3) text after the amount → payment method or note
  const after = segs[amountIdx].slice(am[0].length).trim();
  let method: string | undefined;
  const noteParts: string[] = [];
  if (after) {
    const mm = matchMethod(after, methods);
    if (mm) method = mm;
    else {
      const words = after.split(/\s+/);
      const lastTwo = words.slice(-2).join(' ');
      const m2 = matchMethod(lastTwo, methods) ?? matchMethod(words[words.length - 1], methods);
      if (m2) {
        method = m2;
        const cut = matchMethod(lastTwo, methods) ? 2 : 1;
        if (words.length > cut) noteParts.push(words.slice(0, -cut).join(' '));
      } else noteParts.push(after);
    }
  }
  const others = segs.filter((_, i) => i !== amountIdx).join(' – ');
  if (others) noteParts.unshift(others);
  const note = noteParts.join(', ').trim() || undefined;
  return { raw: base.raw, ok: true, period, amountCents, currency, method, note };
}

export function parseNotes(text: string, methods: string[]): ParsedLine[] {
  return text.split(/\r?\n/).map(l => parseNotesLine(l, methods)).filter((x): x is ParsedLine => x !== null);
}

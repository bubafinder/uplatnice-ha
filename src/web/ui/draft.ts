import { formatAmount } from '../../shared/hub3';
import { normalizeIban } from '../../shared/iban';
import { currentPeriod, fillPlaceholders, hasPlaceholders, type Period } from '../../shared/placeholders';
import { emptySlip, type Profile, type Slip, type Template } from '../../shared/types';

/** The slip being edited (text may contain {mjesec}...). */
export interface Draft {
  slip: Slip;
  amountText: string;
  useProfile: boolean;
  templateId?: string;
  period: Period;
  key: number; // bump to reset form fields
}

let k = 0;
export const newDraft = (profileFilled: boolean): Draft => ({
  slip: emptySlip(), amountText: '', useProfile: profileFilled, period: currentPeriod(), key: ++k,
});

export const draftFromTemplate = (t: Template): Draft => ({
  slip: structuredClone(t.slip), amountText: formatAmount(t.slip.amountCents), useProfile: t.useProfile,
  templateId: t.id, period: currentPeriod(), key: ++k,
});

export const draftFromSlip = (s: Slip, useProfile: boolean): Draft => ({
  slip: s, amountText: formatAmount(s.amountCents), useProfile, period: currentPeriod(), key: ++k,
});

const TEXT_KEYS = ['description', 'reference'] as const;

export function draftUsesPlaceholders(s: Slip): boolean {
  return [s.description, s.reference, s.payee.name, s.payer.name].some(hasPlaceholders);
}

/** Final slip for the barcode: placeholders filled and payer profile applied. */
export function effectiveSlip(d: Draft, profile: Profile): Slip {
  const f = (v: string) => fillPlaceholders(v, d.period);
  const s = d.slip;
  const payer = d.useProfile ? { name: profile.name, street: profile.street, city: profile.city } : s.payer;
  const out: Slip = {
    ...s,
    payer: { name: f(payer.name), street: f(payer.street), city: f(payer.city) },
    payee: { name: f(s.payee.name), street: f(s.payee.street), city: f(s.payee.city), iban: normalizeIban(s.payee.iban) },
    // no reference with HR00 → HR99 (HUB rule)
    model: !fillPlaceholders(s.reference, d.period).trim() && ['', 'HR00'].includes(s.model.trim().toUpperCase()) ? 'HR99' : s.model.trim().toUpperCase(),
    purpose: s.purpose.trim().toUpperCase(),
  };
  for (const key of TEXT_KEYS) out[key] = f(s[key]);
  return out;
}

export interface Suggestion { text: string; period: Period }

/** Suggestion: "Članarina studeni 2026" → "Članarina {mjesec} {godina}" (plus the month found in the text). */
export function suggestPlaceholders(text: string, p: Period): Suggestion | null {
  if (hasPlaceholders(text)) return null;
  const months = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];
  // \b does not work with Croatian letters, so word boundaries are checked manually
  const re = new RegExp(`(^|[^\\p{L}])(${months.join('|')})(?![\\p{L}])(\\s+(\\d{4})\\.?)?`, 'iu');
  const m = re.exec(text);
  if (!m) {
    // numeric form: "05/25" → {mm}/{gg}, "05/2025" → {mm}/{godina}
    const n = /(?<![\d/.])(0?[1-9]|1[0-2])([/.])(\d{4}|\d{2})(?![\d/])/.exec(text);
    if (!n) return null;
    const [all, mo, sep, yr] = n;
    const year = yr.length === 2 ? 2000 + Number(yr) : Number(yr);
    const tok = `{mm}${sep}${yr.length === 2 ? '{gg}' : '{godina}'}`;
    return { text: text.slice(0, n.index) + tok + text.slice(n.index + all.length), period: { year, month: Number(mo) } };
  }
  const [, pre, name, yrPart, yr] = m;
  const month = months.indexOf(name.toLowerCase()) + 1;
  const tok = name === name.toUpperCase() ? '{MJESEC}' : name[0] === name[0].toUpperCase() ? '{Mjesec}' : '{mjesec}';
  const replaced = pre + tok + (yrPart ? yrPart.replace(yr, '{godina}') : '');
  return {
    text: text.slice(0, m.index) + replaced + text.slice(m.index + m[0].length),
    period: { year: yr ? Number(yr) : p.year, month },
  };
}

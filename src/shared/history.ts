// Payment history: months, grouping by year, totals, missing months
import { MONTHS } from './placeholders';
import type { Currency, Payment } from './types';

export const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}`;
export const parseYm = (s: string) => ({ year: Number(s.slice(0, 4)), month: Number(s.slice(5, 7)) });
export const currentYm = (d = new Date()) => ym(d.getFullYear(), d.getMonth() + 1);
export const todayIso = (d = new Date()) => `${ym(d.getFullYear(), d.getMonth() + 1)}-${String(d.getDate()).padStart(2, '0')}`;

/** '2025-11' → '11/25' */
export const shortYm = (s: string) => `${s.slice(5, 7)}/${s.slice(2, 4)}`;
/** '2025-11' → 'studeni 2025.' (long Croatian month label) */
export const longYm = (s: string) => `${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}.`;
/** '2026-10-30' → '30.10.2026.' */
export const fmtDate = (iso?: string) => (iso ? `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}.` : '');

/** Parses 'MM/YY', 'M/YY', 'MM/YYYY', 'MM.YY' → 'YYYY-MM', or null */
export function parsePeriodInput(s: string): string | null {
  const m = /^\s*(\d{1,2})\s*[/.\-]\s*(\d{2}|\d{4})\s*\.?\s*$/.exec(s);
  if (!m) return null;
  const month = Number(m[1]);
  if (month < 1 || month > 12) return null;
  const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
  return ym(year, month);
}

function nextYm(s: string): string {
  const { year, month } = parseYm(s);
  return month === 12 ? ym(year + 1, 1) : ym(year, month + 1);
}

export type Row =
  | { kind: 'payment'; p: Payment }
  | { kind: 'missing'; ym: string }
  | { kind: 'gap'; from: string; to: string; count: number }; // 3+ consecutive empty months

export interface YearGroup {
  year: number;
  rows: Row[];
  totals: Partial<Record<Currency, number>>;
  count: number;
}

/** Months without a payment between the first payment and now (pause months excluded). */
export function missingMonths(payments: Payment[], pauseMonths: number[], now = currentYm()): string[] {
  const periods = new Set(payments.map(p => p.period).filter(Boolean) as string[]);
  if (!periods.size) return [];
  const sorted = [...periods].sort();
  const last = sorted[sorted.length - 1] > now ? sorted[sorted.length - 1] : now;
  const out: string[] = [];
  for (let m = sorted[0]; m <= last; m = nextYm(m)) {
    if (!periods.has(m) && !pauseMonths.includes(parseYm(m).month)) out.push(m);
  }
  return out;
}

/** Payments grouped by year, newest first, with totals. */
export function groupByYear(payments: Payment[], pauseMonths: number[], now = currentYm()): YearGroup[] {
  const rows: (Row & { key: string; t: string })[] = [
    ...payments.map(p => ({ kind: 'payment' as const, p, key: p.period ?? p.at, t: p.createdAt })),
    ...missingMonths(payments, pauseMonths, now).map(m => ({ kind: 'missing' as const, ym: m, key: m, t: '' })),
  ];
  rows.sort((a, b) => (a.key === b.key ? b.t.localeCompare(a.t) : b.key.localeCompare(a.key)));
  const groups = new Map<number, YearGroup>();
  for (const r of rows) {
    const year = Number(r.key.slice(0, 4));
    let g = groups.get(year);
    if (!g) groups.set(year, (g = { year, rows: [], totals: {}, count: 0 }));
    const { key: _k, t: _t, ...row } = r;
    g.rows.push(row as Row);
    if (r.kind === 'payment' && r.p.amountCents) {
      g.totals[r.p.currency] = (g.totals[r.p.currency] ?? 0) + r.p.amountCents;
      g.count++;
    }
  }
  for (const g of groups.values()) g.rows = collapseGaps(g.rows);
  return [...groups.values()].sort((a, b) => b.year - a.year);
}

function collapseGaps(rows: Row[]): Row[] {
  const out: Row[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length >= 3) out.push({ kind: 'gap', from: run[run.length - 1], to: run[0], count: run.length });
    else for (const m of run) out.push({ kind: 'missing', ym: m });
    run = [];
  };
  for (const r of rows) {
    if (r.kind === 'missing') run.push(r.ym);
    else { flush(); out.push(r); }
  }
  flush();
  return out;
}

export type Status =
  | { kind: 'paid'; cents: number; currency: Currency }
  | { kind: 'pause' }
  | { kind: 'unpaid' };

export function statusFor(payments: Payment[], pauseMonths: number[], month = currentYm()): Status {
  const paid = payments.filter(p => p.period === month);
  if (paid.length) {
    const cur = paid[0].currency;
    return { kind: 'paid', cents: paid.filter(p => p.currency === cur).reduce((a, p) => a + (p.amountCents ?? 0), 0), currency: cur };
  }
  if (pauseMonths.includes(parseYm(month).month)) return { kind: 'pause' };
  return { kind: 'unpaid' };
}

export const lastPayment = (payments: Payment[]) =>
  [...payments].sort((a, b) => ((b.period ?? b.at) + b.createdAt).localeCompare((a.period ?? a.at) + a.createdAt))[0];

export const currencyLabel = (c: Currency) => (c === 'EUR' ? 'EUR' : 'kn');

/** Croatian plural form for a count: 1 mjesec, 2 mjeseca, 5 mjeseci, 21 mjesec, 22 mjeseca */
export function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return `${n} ${one}`;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return `${n} ${few}`;
  return `${n} ${many}`;
}

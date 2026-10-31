// Template placeholders: {mjesec}, {Mjesec}, {MJESEC}, {mm}, {gg}, {godina}

export const MONTHS = ['siječanj', 'veljača', 'ožujak', 'travanj', 'svibanj', 'lipanj', 'srpanj', 'kolovoz', 'rujan', 'listopad', 'studeni', 'prosinac'];

export interface Period { year: number; month: number } // month 1-12

export const currentPeriod = (d = new Date()): Period => ({ year: d.getFullYear(), month: d.getMonth() + 1 });

export const shiftPeriod = (p: Period, by: number): Period => {
  const i = p.year * 12 + (p.month - 1) + by;
  return { year: Math.floor(i / 12), month: (i % 12) + 1 };
};

export const periodLabel = (p: Period) => `${MONTHS[p.month - 1]} ${p.year}.`;

const TOKEN = /\{(mjesec|Mjesec|MJESEC|mm|gg|godina)\}/g;

export const hasPlaceholders = (s: string) => new RegExp(TOKEN.source).test(s);

export function fillPlaceholders(s: string, p: Period): string {
  const name = MONTHS[p.month - 1];
  return s.replace(TOKEN, (_, t: string) => {
    switch (t) {
      case 'mjesec': return name;
      case 'Mjesec': return name[0].toUpperCase() + name.slice(1);
      case 'MJESEC': return name.toUpperCase();
      case 'mm': return String(p.month).padStart(2, '0');
      case 'gg': return String(p.year).slice(-2);
      case 'godina': return String(p.year);
    }
    return _;
  });
}

export const PLACEHOLDER_HELP: { token: string; example: (p: Period) => string }[] = [
  { token: '{mjesec}', example: p => MONTHS[p.month - 1] },
  { token: '{Mjesec}', example: p => fillPlaceholders('{Mjesec}', p) },
  { token: '{mm}', example: p => String(p.month).padStart(2, '0') },
  { token: '{gg}', example: p => String(p.year).slice(-2) },
  { token: '{godina}', example: p => String(p.year) },
];

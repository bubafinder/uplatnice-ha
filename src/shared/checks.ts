// Check digit algorithms (HUB: overview of basic payment reference models)

const digits = (s: string) => s.split('').map(Number);

/** MOD11INI – the most common one; the last digit is the check digit. */
export function mod11ini(s: string): boolean {
  if (!/^\d{2,}$/.test(s)) return false;
  const d = digits(s);
  const k = d.pop()!;
  let sum = 0;
  for (let i = d.length - 1, w = 2; i >= 0; i--, w++) sum += d[i] * w;
  const r = sum % 11;
  return (r <= 1 ? 0 : 11 - r) === k;
}

/** ISO 7064 MOD 11,10 – used for OIB and similar identifiers. */
export function iso7064(s: string): boolean {
  if (!/^\d{2,}$/.test(s)) return false;
  const d = digits(s);
  const k = d.pop()!;
  let p = 10;
  for (const x of d) {
    let t = (x + p) % 10;
    if (t === 0) t = 10;
    p = (t * 2) % 11;
  }
  return (11 - p) % 10 === k;
}

/** MOD11JMB – checks the whole string, no separate check digit (HR12, HR41, HR42). */
export function mod11jmb(s: string): boolean {
  if (!/^\d+$/.test(s) || /^(\d)\1*$/.test(s)) return false;
  const d = digits(s);
  let sum = 0;
  for (let i = d.length - 1, n = 0; i >= 0; i--, n++) {
    const w = n < 7 ? n + 1 : ((n - 7) % 6) + 2;
    sum += d[i] * w;
  }
  return sum % 11 === 0;
}

/** Weights 2..7, then restart at 2, right to left. */
function sum27(d: number[]): number {
  let sum = 0;
  for (let i = d.length - 1, n = 0; i >= 0; i--, n++) sum += d[i] * ((n % 6) + 2);
  return sum;
}

/** MOD11P7 (HR13, HR18). */
export function mod11p7(s: string): boolean {
  if (!/^\d{2,}$/.test(s)) return false;
  const d = digits(s);
  const k = d.pop()!;
  const r = sum27(d) % 11;
  const c = r === 0 ? 5 : r === 1 ? 0 : 11 - r;
  return c === k;
}

/** MOD11 (HR40 K2): remainder 0 means invalid. */
export function mod11(s: string): boolean {
  if (!/^\d{2,}$/.test(s)) return false;
  const d = digits(s);
  const k = d.pop()!;
  const r = sum27(d) % 11;
  if (r === 0) return false;
  return (r === 1 ? 0 : 11 - r) === k;
}

/** MOD10ZB (HR14): alternating weights 1,2 from the right; the remainder is the check digit. */
export function mod10zb(s: string): boolean {
  if (!/^\d{2,}$/.test(s)) return false;
  const d = digits(s);
  const k = d.pop()!;
  let sum = 0;
  for (let i = d.length - 1, n = 0; i >= 0; i--, n++) sum += d[i] * (n % 2 === 0 ? 1 : 2);
  return sum % 10 === k;
}

/** MOD10 (HR15, HR40 K1): alternating weights 2,1 from the right, summing the digits of each product. */
export function mod10(s: string): boolean {
  if (!/^\d{2,}$/.test(s)) return false;
  const d = digits(s);
  const k = d.pop()!;
  let sum = 0;
  for (let i = d.length - 1, n = 0; i >= 0; i--, n++) {
    const p = d[i] * (n % 2 === 0 ? 2 : 1);
    sum += p > 9 ? p - 9 : p;
  }
  const r = sum % 10;
  return (r === 0 ? 0 : 10 - r) === k;
}

export const isOib = (s: string) => /^\d{11}$/.test(s) && iso7064(s);

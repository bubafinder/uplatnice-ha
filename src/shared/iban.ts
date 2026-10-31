/** Removes whitespace and upper-cases. */
export const normalizeIban = (s: string) => s.replace(/\s+/g, '').toUpperCase();

/** Formats in groups of 4 characters. */
export const formatIban = (s: string) => normalizeIban(s).replace(/(.{4})(?=.)/g, '$1 ');

function mod97(iban: string): number {
  const re = iban.slice(4) + iban.slice(0, 4);
  let r = 0;
  for (const ch of re) {
    const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55);
    for (const c of v) r = (r * 10 + Number(c)) % 97;
  }
  return r;
}

/** Returns a user-facing error message, or null if the Croatian IBAN is valid. */
export function ibanError(raw: string): string | null {
  const s = normalizeIban(raw);
  if (!s) return 'Upiši IBAN primatelja.';
  if (!s.startsWith('HR')) return 'Hrvatski IBAN počinje s HR.';
  if (!/^HR\d+$/.test(s)) return 'Nakon HR dolaze samo znamenke.';
  if (s.length !== 21) return `IBAN ima ${s.length} znakova, a treba 21.`;
  if (mod97(s) !== 1) return 'Kontrolni broj IBAN-a nije ispravan. Provjeri jesi li dobro prepisao.';
  return null;
}

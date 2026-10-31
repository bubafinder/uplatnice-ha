// Character set and field length rules from the HUB-3A spec (v6, 2022)

/** Maximum field lengths in characters (not bytes). */
export const MAX = {
  'payer.name': 30,
  'payer.street': 27,
  'payer.city': 27,
  'payee.name': 25,
  'payee.street': 25,
  'payee.city': 27,
  'payee.iban': 21,
  model: 4,
  reference: 22,
  purpose: 4,
  description: 35,
} as const;

const ALLOWED = /[0-9A-Za-zČĆĐŠŽčćđšž ,.:\-+?'/()]/u;

/** Character count (Croatian letters count as one character although they are 2 bytes in UTF-8). */
export const charLength = (s: string): number => [...s].length;

/** Returns disallowed characters (unique, in order of appearance). */
export function invalidChars(s: string): string[] {
  const out: string[] = [];
  for (const ch of s) if (!ALLOWED.test(ch) && !out.includes(ch)) out.push(ch);
  return out;
}

/** Replacements for common disallowed characters. */
const REPLACE: Record<string, string> = {
  '–': '-', '—': '-', '‘': "'", '’': "'", '`': "'", '"': "'", '„': "'", '“': "'", '”': "'",
  '&': '+', '_': '-', ';': ',', '!': '.', '#': '', '*': '', '\t': ' ', '\n': ' ', '\r': '',
  'ä': 'a', 'ö': 'o', 'ü': 'u', 'Ä': 'A', 'Ö': 'O', 'Ü': 'U', 'ß': 'ss',
  'é': 'e', 'è': 'e', 'É': 'E', 'á': 'a', 'à': 'a', 'í': 'i', 'ó': 'o', 'ú': 'u',
  'ǆ': 'dž', 'ǅ': 'Dž', 'Ǆ': 'DŽ', 'ǉ': 'lj', 'ǈ': 'Lj', 'Ǉ': 'LJ', 'ǌ': 'nj', 'ǋ': 'Nj', 'Ǌ': 'NJ',
};

/** Converts text to the allowed character set (for imported data). */
export function sanitize(s: string): string {
  let out = '';
  for (const ch of s.normalize('NFC')) {
    if (ALLOWED.test(ch)) out += ch;
    else if (ch in REPLACE) out += REPLACE[ch];
  }
  return out.replace(/ {2,}/g, ' ');
}

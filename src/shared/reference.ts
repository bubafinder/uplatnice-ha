// Payment reference models per HUB's "Jedinstveni pregled osnovnih modela poziva na broj"
import { iso7064, mod10, mod10zb, mod11, mod11ini, mod11jmb, mod11p7 } from './checks';

type Alg = 'mod11ini' | 'iso7064' | 'mod11jmb' | 'mod11p7' | 'mod10zb' | 'mod10' | 'mod11ini|oib';

interface PartRule {
  max?: number; // max digits (default 12)
  exact?: number | number[]; // exact digit count
  first?: string; // allowed first digits
  notZeroFirst?: boolean;
}

interface Check {
  parts: number[]; // part indexes (0 = P1) covered by one check digit
  alg: Alg;
}

export interface ModelDef {
  code: string;
  label: string; // short label for the picker
  min: number;
  max: number;
  parts: PartRule[];
  checks: Check[];
  restricted?: string; // who may use this model
  custom?: (p: string[]) => string | null;
}

const P = (n = 3, rule: PartRule = {}): PartRule[] => Array.from({ length: n }, () => ({ ...rule }));
const basic = (code: string, label: string, checks: Check[], extra: Partial<ModelDef> = {}): ModelDef => ({
  code, label, min: 1, max: 3, parts: P(), checks, ...extra,
});
const NAREDBA = 'Samo za uplate javnih prihoda prema Naredbi (porezi, doprinosi).';

export const MODELS: ModelDef[] = [
  basic('HR00', 'Bez kontrole (najčešće)', []),
  basic('HR01', 'Jedan kontrolni broj za cijeli poziv na broj', [{ parts: [0, 1, 2], alg: 'mod11ini' }]),
  basic('HR02', 'P1 - (P2)K - (P3)K', [{ parts: [1], alg: 'mod11ini' }, { parts: [2], alg: 'mod11ini' }]),
  basic('HR03', '(P1)K - (P2)K - (P3)K', [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'mod11ini' }, { parts: [2], alg: 'mod11ini' }]),
  basic('HR04', '(P1)K - P2 - (P3)K', [{ parts: [0], alg: 'mod11ini' }, { parts: [2], alg: 'mod11ini' }]),
  basic('HR05', '(P1)K - P2 - P3', [{ parts: [0], alg: 'mod11ini' }]),
  basic('HR06', 'P1 - (P2 - P3)K', [{ parts: [1, 2], alg: 'mod11ini' }]),
  basic('HR07', 'P1 - (P2)K - P3', [{ parts: [1], alg: 'mod11ini' }]),
  basic('HR08', '(P1 - P2)K - (P3)K', [{ parts: [0, 1], alg: 'mod11ini' }, { parts: [2], alg: 'mod11ini' }]),
  basic('HR09', '(P1 - P2)K - P3', [{ parts: [0, 1], alg: 'mod11ini' }]),
  basic('HR10', '(P1)K - (P2 - P3)K', [{ parts: [0], alg: 'mod11ini' }, { parts: [1, 2], alg: 'mod11ini' }]),
  basic('HR11', '(P1)K - (P2)K - P3', [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'mod11ini' }]),
  basic('HR12', '(P1 = JMBG)K - P2 - P3', [{ parts: [0], alg: 'mod11jmb' }], { parts: [{ exact: 13 }, {}, {}] }),
  basic('HR13', '(P1)K - P2 - P3, P1 = 10 znamenaka', [{ parts: [0], alg: 'mod11p7' }], { parts: [{ exact: 10, first: '3' }, {}, {}] }),
  basic('HR14', '(P1)K - P2 - P3, P1 = 10 znamenaka', [{ parts: [0], alg: 'mod10zb' }], { parts: [{ exact: 10 }, {}, {}] }),
  { code: 'HR15', label: '(P1)K - (P2)K', min: 1, max: 2, parts: [{ exact: 8 }, { exact: 11 }], checks: [{ parts: [0], alg: 'mod10' }, { parts: [1], alg: 'mod10' }] },
  { code: 'HR16', label: '(P1)K - (P2)K - P3', min: 3, max: 3, parts: [{ exact: 5 }, { exact: 4 }, { exact: 8 }], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'mod11ini' }] },
  basic('HR17', '(P1)K - P2 - P3', [{ parts: [0], alg: 'iso7064' }]),
  basic('HR18', '(P1)K - P2 - P3', [{ parts: [0], alg: 'mod11p7' }]),
  { code: 'HR23', label: 'Javni prihodi', min: 1, max: 4, parts: [{ exact: 4, first: '6' }, {}, {}, {}], checks: [{ parts: [0], alg: 'mod11ini' }], restricted: NAREDBA,
    custom: p => (p.slice(1).join('').length > 15 ? 'Podaci P2 do P4 zajedno smiju imati najviše 15 znamenaka.' : null) },
  { code: 'HR24', label: 'Javni prihodi', min: 1, max: 4, parts: [{ exact: 4 }, { max: 13 }, {}, {}], checks: [{ parts: [0], alg: 'mod11ini' }], restricted: NAREDBA },
  { code: 'HR26', label: 'Javni prihodi', min: 3, max: 4, parts: [{ exact: 4 }, { max: 11 }, { max: 11 }, {}], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'mod11ini|oib' }, { parts: [2], alg: 'mod11ini|oib' }], restricted: NAREDBA },
  { code: 'HR27', label: 'Javni prihodi', min: 2, max: 2, parts: [{ exact: 4 }, {}], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'mod11ini' }], restricted: NAREDBA },
  { code: 'HR28', label: 'Javni prihodi', min: 3, max: 4, parts: [{ exact: 4 }, { exact: 3 }, { exact: 6 }, { max: 6 }], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'mod11ini' }, { parts: [2], alg: 'mod11ini' }], restricted: NAREDBA },
  { code: 'HR29', label: 'Javni prihodi', min: 3, max: 3, parts: [{ exact: 4 }, {}, {}], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'mod11ini' }, { parts: [2], alg: 'mod11ini' }], restricted: NAREDBA },
  { code: 'HR30', label: 'Proračun', min: 3, max: 3, parts: [{ exact: 10 }, { exact: 4 }, { max: 6 }], checks: [] },
  { code: 'HR31', label: 'Proračun', min: 1, max: 4, parts: [{ max: 6 }, {}, {}, {}], checks: [{ parts: [0], alg: 'iso7064' }] },
  { code: 'HR33', label: 'Proračun', min: 3, max: 3, parts: [{ max: 6 }, { max: 7 }, { max: 7 }], checks: [{ parts: [0], alg: 'iso7064' }, { parts: [1], alg: 'iso7064' }] },
  { code: 'HR34', label: 'Proračun', min: 3, max: 3, parts: [{ max: 6 }, { max: 7 }, { max: 5, notZeroFirst: true }], checks: [{ parts: [0], alg: 'iso7064' }, { parts: [1], alg: 'iso7064' }, { parts: [2], alg: 'iso7064' }] },
  { code: 'HR40', label: 'Proračun', min: 1, max: 3, parts: [{ exact: 11, first: '0' }, {}, {}], checks: [],
    custom: p => (mod10(p[0].slice(0, 10)) && mod11(p[0]) ? null : 'Kontrolni brojevi u prvom podatku nisu ispravni.') },
  basic('HR41', '(P1 = JMBG)K - P2 - P3', [{ parts: [0], alg: 'mod11jmb' }], { parts: [{ exact: 13 }, {}, {}] }),
  { code: 'HR43', label: 'Naplata čekova', min: 4, max: 4, parts: [{ exact: 3 }, { exact: 8 }, { exact: 5 }, { exact: 3 }], checks: [{ parts: [1], alg: 'mod11ini' }] },
  { code: 'HR50', label: 'Samo PBZ', min: 3, max: 3, parts: [{ exact: 5 }, { exact: 12 }, { exact: 1 }], checks: [], restricted: 'Koristi samo Privredna banka Zagreb.' },
  basic('HR55', '(P1)K - P2 - P3', [{ parts: [0], alg: 'mod11ini' }]),
  { code: 'HR62', label: 'Javni prihodi', min: 3, max: 4, parts: [{ exact: 4 }, { max: 5, notZeroFirst: true }, { max: 6 }, {}], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'iso7064' }, { parts: [2], alg: 'mod11ini' }], restricted: NAREDBA },
  { code: 'HR63', label: 'Javni prihodi', min: 3, max: 3, parts: [{ exact: 4 }, { max: 5, notZeroFirst: true }, {}], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'iso7064' }, { parts: [2], alg: 'mod11ini' }], restricted: NAREDBA },
  { code: 'HR64', label: 'Javni prihodi', min: 3, max: 4, parts: [{ exact: 4 }, { max: 5, notZeroFirst: true }, {}, { max: 9 }], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'iso7064' }], restricted: NAREDBA,
    custom: p => (p[2] && p[2].length === 11 && !iso7064(p[2]) ? 'Treći podatak ima 11 znamenaka pa mora biti ispravan OIB.' : null) },
  { code: 'HR65', label: 'Javni prihodi', min: 3, max: 4, parts: [{ exact: 4 }, { exact: 3 }, { exact: [2, 3, 4, 5, 11] }, {}], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'mod11ini' }, { parts: [2], alg: 'iso7064' }], restricted: NAREDBA },
  { code: 'HR67', label: 'OIB - P2 - P3 (npr. HOK)', min: 1, max: 3, parts: [{ exact: 11 }, { max: 10 }, { max: 8 }], checks: [{ parts: [0], alg: 'iso7064' }] },
  { code: 'HR68', label: 'Porezi i doprinosi', min: 2, max: 3, parts: [{ exact: 4 }, { exact: 11 }, {}], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'iso7064' }], restricted: NAREDBA },
  { code: 'HR69', label: 'Doprinosi, osobna primanja', min: 2, max: 3, parts: [{ exact: 5 }, { exact: 11 }, {}], checks: [{ parts: [0], alg: 'mod11ini' }, { parts: [1], alg: 'iso7064' }] },
  { code: 'HR83', label: 'Samo FINA', min: 2, max: 3, parts: [{ exact: 4 }, { exact: [5, 7, 16], first: '03', max: 16 }, { exact: 6, first: '12' }], checks: [{ parts: [0], alg: 'mod11ini' }], restricted: 'Koristi samo FINA.' },
  { code: 'HR84', label: 'Samo FINA', min: 2, max: 3, parts: [{ exact: 4 }, { exact: [4, 8] }, { exact: 10 }], checks: [{ parts: [0], alg: 'mod11ini' }], restricted: 'Koristi samo FINA.' },
  { code: 'HR99', label: 'Bez poziva na broj', min: 0, max: 0, parts: [], checks: [] },
];

export const MODEL_MAP = new Map(MODELS.map(m => [m.code, m]));

const runAlg = (alg: Alg, s: string): boolean => {
  switch (alg) {
    case 'mod11ini': return mod11ini(s);
    case 'iso7064': return iso7064(s);
    case 'mod11jmb': return mod11jmb(s);
    case 'mod11p7': return mod11p7(s);
    case 'mod10zb': return mod10zb(s);
    case 'mod10': return mod10(s);
    case 'mod11ini|oib': return s.length === 11 ? iso7064(s) : mod11ini(s);
  }
};

const ORD = ['prvom', 'drugom', 'trećem', 'četvrtom'];
const ORD_N = ['Prvi', 'Drugi', 'Treći', 'Četvrti'];

/** Returns a user-facing error message, or null if the reference matches the model. */
export function referenceError(modelRaw: string, refRaw: string): string | null {
  const model = modelRaw.trim().toUpperCase();
  const ref = refRaw.trim();
  if (!model) return ref ? 'Odaberi model.' : null;
  if (!/^HR\d{2}$/.test(model)) return 'Model se piše kao HR i dvije znamenke, npr. HR00.';
  const def = MODEL_MAP.get(model);
  if (!def) return `Model ${model} ne postoji na HUB-ovom popisu modela.`;
  if (def.code === 'HR99') return ref ? 'Uz model HR99 poziv na broj ostaje prazan.' : null;
  if (!ref) return `Model ${model} traži poziv na broj. Ako ga nemaš, odaberi HR99.`;
  if (ref.length > 22) return `Poziv na broj ima ${ref.length} znakova, a smije najviše 22.`;
  if (!/^[\d-]+$/.test(ref)) return 'Poziv na broj smije sadržavati samo znamenke i crtice.';
  const parts = ref.split('-');
  if (parts.some(p => p === '')) return 'Između crtica mora biti barem jedna znamenka.';
  if (parts.length < def.min) return `Model ${model} traži najmanje ${def.min} ${def.min === 1 ? 'podatak' : 'podatka'} odvojena crticom.`;
  if (parts.length > def.max) return `Model ${model} dopušta najviše ${def.max} ${def.max === 1 ? 'podatak' : 'podatka'}.`;
  for (let i = 0; i < parts.length; i++) {
    const r = def.parts[i] ?? {};
    const p = parts[i];
    const exact = r.exact === undefined ? undefined : Array.isArray(r.exact) ? r.exact : [r.exact];
    if (exact && !exact.includes(p.length))
      return `${ORD_N[i]} podatak mora imati ${exact.join(' ili ')} znamenaka (sada ${p.length}).`;
    if (!exact && p.length > (r.max ?? 12)) return `${ORD_N[i]} podatak smije imati najviše ${r.max ?? 12} znamenaka.`;
    if (r.first && !r.first.includes(p[0])) return `${ORD_N[i]} podatak mora počinjati s ${r.first.split('').join(' ili ')}.`;
    if (r.notZeroFirst && p[0] === '0') return `${ORD_N[i]} podatak ne smije počinjati nulom.`;
  }
  for (const c of def.checks) {
    const present = c.parts.filter(i => i < parts.length);
    if (!present.length) continue;
    const s = present.map(i => parts[i]).join('');
    if (s.length < 2 || !runAlg(c.alg, s)) {
      const where = present.length > 1 ? `podacima ${present.map(i => 'P' + (i + 1)).join(' i ')}` : `${ORD[present[0]]} podatku`;
      return `Kontrolni broj u ${where} nije ispravan za model ${model}.`;
    }
  }
  return def.custom ? def.custom(parts) : null;
}

/** Computes the MOD11INI check digit (input helper). */
export function mod11iniDigit(body: string): number {
  let sum = 0;
  for (let i = body.length - 1, w = 2; i >= 0; i--, w++) sum += Number(body[i]) * w;
  const r = sum % 11;
  return r <= 1 ? 0 : 11 - r;
}

// Application state shared by the server and the web client, plus backup migration
import type { OwnerRef, Payment, Profile, Template, Tracker } from './types';

export const DEFAULT_METHODS = ['Aircash', 'mBanking', 'Internet bankarstvo', 'Gotovina', 'Banka/pošta', 'Trajni nalog'];

export interface Settings {
  methods: string[];
  lastMethod?: string;
  lastBackupAt?: string;
}

export interface AppState extends Settings {
  profile: Profile;
  templates: Template[];
  trackers: Tracker[];
  me?: { name: string }; // current Home Assistant user (display only)
}

export const emptyProfile = (): Profile => ({ name: '', street: '', city: '', iban: '' });

export const emptyState = (): AppState => ({
  profile: emptyProfile(),
  templates: [],
  trackers: [],
  methods: [...DEFAULT_METHODS],
});

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** Accepts backups from the standalone HTML app (v1 and v2) and normalises them. */
export function migrateBackup(raw: any): AppState {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.templates)) throw new Error('Ovo nije sigurnosna kopija aplikacije Uplatnice.');
  const e = emptyState();
  return {
    profile: { ...e.profile, ...(raw.profile ?? {}) },
    templates: arr<any>(raw.templates).map(t => ({ ...t, payments: arr<Payment>(t.payments), pauseMonths: arr<number>(t.pauseMonths) })),
    trackers: arr<any>(raw.trackers).map(t => ({ ...t, payments: arr<Payment>(t.payments), pauseMonths: arr<number>(t.pauseMonths) })),
    methods: arr<string>(raw.methods).length ? arr<string>(raw.methods) : e.methods,
    lastMethod: raw.lastMethod,
    lastBackupAt: raw.lastBackupAt,
  };
}

// ---------- sync operations (client → server) ----------

export type Op =
  | { type: 'profile'; profile: Profile }
  | { type: 'settings'; settings: Settings }
  | { type: 'template.put'; template: Omit<Template, 'payments'> }
  | { type: 'template.delete'; id: string }
  | { type: 'tracker.put'; tracker: Omit<Tracker, 'payments'> }
  | { type: 'tracker.delete'; id: string }
  | { type: 'payment.put'; owner: OwnerRef; payment: Payment }
  | { type: 'payment.delete'; id: string };

const strip = <T extends { payments: Payment[] }>(o: T): Omit<T, 'payments'> => {
  const { payments: _p, ...rest } = o;
  return rest;
};

// fields maintained by the server are ignored when diffing
const paymentKey = (p: Payment) => JSON.stringify({ ...p, recordedBy: undefined, receipts: undefined });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Computes the minimal list of operations that turns `prev` into `next`. */
export function diffState(prev: AppState, next: AppState): Op[] {
  const ops: Op[] = [];
  if (!same(prev.profile, next.profile)) ops.push({ type: 'profile', profile: next.profile });
  const settings = (s: AppState): Settings => ({ methods: s.methods, lastMethod: s.lastMethod, lastBackupAt: s.lastBackupAt });
  if (!same(settings(prev), settings(next))) ops.push({ type: 'settings', settings: settings(next) });

  const owners = (kind: 'template' | 'tracker', a: (Template | Tracker)[], b: (Template | Tracker)[]) => {
    const before = new Map(a.map(o => [o.id, o]));
    const after = new Map(b.map(o => [o.id, o]));
    for (const [id, o] of after) {
      const old = before.get(id);
      if (!old || !same(strip(old), strip(o)))
        ops.push(kind === 'template' ? { type: 'template.put', template: strip(o as Template) } : { type: 'tracker.put', tracker: strip(o as Tracker) });
      const oldPay = new Map((old?.payments ?? []).map(p => [p.id, p]));
      for (const p of o.payments) {
        const op = oldPay.get(p.id);
        if (!op || paymentKey(op) !== paymentKey(p)) ops.push({ type: 'payment.put', owner: { kind, id }, payment: p });
      }
      const newIds = new Set(o.payments.map(p => p.id));
      if (old) for (const p of old.payments) if (!newIds.has(p.id)) ops.push({ type: 'payment.delete', id: p.id });
    }
    for (const id of before.keys()) if (!after.has(id)) ops.push(kind === 'template' ? { type: 'template.delete', id } : { type: 'tracker.delete', id });
  };
  owners('template', prev.templates, next.templates);
  owners('tracker', prev.trackers, next.trackers);
  return ops;
}

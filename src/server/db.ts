// SQLite storage (built-in node:sqlite, no native dependencies)
import { DatabaseSync } from 'node:sqlite';
import { emptyState, migrateBackup, type AppState, type Op, type Settings } from '../shared/state';
import type { OwnerRef, Payment, Profile, Template, Tracker } from '../shared/types';

const MIGRATIONS: string[] = [
  // v1
  `CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE templates (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE trackers (id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT NOT NULL);
   CREATE TABLE payments (
     id TEXT PRIMARY KEY,
     owner_kind TEXT NOT NULL CHECK (owner_kind IN ('template', 'tracker')),
     owner_id TEXT NOT NULL,
     data TEXT NOT NULL,
     recorded_by TEXT,
     updated_at TEXT NOT NULL
   );
   CREATE INDEX payments_owner ON payments (owner_kind, owner_id);`,
];

export class Store {
  private db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
  }

  private migrate() {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    for (let v = row.user_version; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.db.exec(MIGRATIONS[v]);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  private getKv<T>(key: string, fallback: T): T {
    const r = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : fallback;
  }

  private setKv(key: string, value: unknown) {
    this.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value));
  }

  state(): AppState {
    const e = emptyState();
    const payments = new Map<string, Payment[]>();
    for (const r of this.db.prepare('SELECT owner_kind, owner_id, data, recorded_by FROM payments').all() as any[]) {
      const k = `${r.owner_kind}:${r.owner_id}`;
      const p: Payment = { ...JSON.parse(r.data), ...(r.recorded_by ? { recordedBy: r.recorded_by } : {}) };
      (payments.get(k) ?? payments.set(k, []).get(k)!).push(p);
    }
    const byCreated = (a: Payment, b: Payment) => a.createdAt.localeCompare(b.createdAt);
    const templates = (this.db.prepare('SELECT id, data FROM templates').all() as any[]).map(r => ({
      ...(JSON.parse(r.data) as Omit<Template, 'payments'>),
      payments: (payments.get(`template:${r.id}`) ?? []).sort(byCreated),
    }));
    const trackers = (this.db.prepare('SELECT id, data FROM trackers').all() as any[]).map(r => ({
      ...(JSON.parse(r.data) as Omit<Tracker, 'payments'>),
      payments: (payments.get(`tracker:${r.id}`) ?? []).sort(byCreated),
    }));
    const settings = this.getKv<Settings>('settings', { methods: e.methods });
    return { profile: this.getKv<Profile>('profile', e.profile), templates, trackers, ...settings };
  }

  /** Applies client operations atomically. `user` is the Home Assistant user making the change. */
  apply(ops: Op[], user?: string) {
    const now = new Date().toISOString();
    this.tx(() => {
      for (const op of ops) this.applyOne(op, now, user);
    });
  }

  private ownerExists(o: OwnerRef) {
    const table = o.kind === 'template' ? 'templates' : 'trackers';
    return !!this.db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(o.id);
  }

  private applyOne(op: Op, now: string, user?: string) {
    switch (op.type) {
      case 'profile':
        return this.setKv('profile', op.profile);
      case 'settings':
        return this.setKv('settings', op.settings);
      case 'template.put':
        return this.db.prepare('INSERT INTO templates (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
          .run(op.template.id, JSON.stringify(op.template), now);
      case 'tracker.put':
        return this.db.prepare('INSERT INTO trackers (id, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
          .run(op.tracker.id, JSON.stringify(op.tracker), now);
      case 'template.delete':
        this.db.prepare("DELETE FROM payments WHERE owner_kind = 'template' AND owner_id = ?").run(op.id);
        return this.db.prepare('DELETE FROM templates WHERE id = ?').run(op.id);
      case 'tracker.delete':
        this.db.prepare("DELETE FROM payments WHERE owner_kind = 'tracker' AND owner_id = ?").run(op.id);
        return this.db.prepare('DELETE FROM trackers WHERE id = ?').run(op.id);
      case 'payment.put': {
        // the owner may have been deleted by someone else in the meantime
        if (!this.ownerExists(op.owner)) return;
        const { recordedBy: _r, ...data } = op.payment;
        return this.db.prepare(
          `INSERT INTO payments (id, owner_kind, owner_id, data, recorded_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET owner_kind = excluded.owner_kind, owner_id = excluded.owner_id, data = excluded.data, updated_at = excluded.updated_at`,
        ).run(op.payment.id, op.owner.kind, op.owner.id, JSON.stringify(data), user ?? null, now);
      }
      case 'payment.delete':
        return this.db.prepare('DELETE FROM payments WHERE id = ?').run(op.id);
    }
  }

  /** Merges a backup from the standalone app. Existing items with the same id are kept unchanged. */
  importBackup(raw: unknown, user?: string): { templates: number; trackers: number; payments: number } {
    const b = migrateBackup(raw);
    const cur = this.state();
    const ops: Op[] = [];
    const counts = { templates: 0, trackers: 0, payments: 0 };
    if (!cur.profile.name.trim() && b.profile.name.trim()) ops.push({ type: 'profile', profile: b.profile });
    const methods = [...cur.methods, ...b.methods.filter(m => !cur.methods.includes(m))];
    ops.push({ type: 'settings', settings: { methods, lastMethod: cur.lastMethod ?? b.lastMethod, lastBackupAt: cur.lastBackupAt } });
    const existingPayments = new Set([...cur.templates, ...cur.trackers].flatMap(o => o.payments.map(p => p.id)));
    const owners = (kind: 'template' | 'tracker', list: (Template | Tracker)[], have: Set<string>) => {
      for (const o of list) {
        const { payments, ...rest } = o;
        if (!have.has(o.id)) {
          ops.push(kind === 'template' ? { type: 'template.put', template: rest as Omit<Template, 'payments'> } : { type: 'tracker.put', tracker: rest as Omit<Tracker, 'payments'> });
          counts[kind === 'template' ? 'templates' : 'trackers']++;
        }
        for (const p of payments) {
          if (existingPayments.has(p.id)) continue;
          ops.push({ type: 'payment.put', owner: { kind, id: o.id }, payment: p });
          counts.payments++;
        }
      }
    };
    owners('template', b.templates, new Set(cur.templates.map(t => t.id)));
    owners('tracker', b.trackers, new Set(cur.trackers.map(t => t.id)));
    this.apply(ops, user);
    return counts;
  }

  close() {
    this.db.close();
  }
}

// SQLite storage (built-in node:sqlite, no native dependencies)
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { emptyState, migrateBackup, type AppState, type Op, type Settings } from '../shared/state';
import type { OwnerRef, Payment, Profile, ReceiptMeta, Template, Tracker } from '../shared/types';
import { cleanFileName } from './files';

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
  // v2: payment confirmations; file contents live in the receipts directory
  `CREATE TABLE receipts (
     id TEXT PRIMARY KEY,
     payment_id TEXT NOT NULL,
     file_name TEXT NOT NULL,
     mime TEXT NOT NULL,
     size INTEGER NOT NULL,
     uploaded_by TEXT,
     created_at TEXT NOT NULL
   );
   CREATE INDEX receipts_payment ON receipts (payment_id);`,
];

export interface ReceiptFile extends ReceiptMeta {
  paymentId: string;
  path: string;
}

export class Store {
  private db: DatabaseSync;
  readonly receiptsDir: string;
  private pendingFileDeletes: string[] = [];

  constructor(file: string, receiptsDir = join(dirname(file), 'receipts')) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
    this.migrate();
    this.receiptsDir = receiptsDir;
    mkdirSync(receiptsDir, { recursive: true });
    this.removeOrphanFiles();
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
      // files are removed only once the rows are gone for good
      for (const id of this.pendingFileDeletes.splice(0)) rmSync(this.receiptPath(id), { force: true });
      return r;
    } catch (e) {
      this.db.exec('ROLLBACK');
      this.pendingFileDeletes = [];
      throw e;
    }
  }

  private receiptPath(id: string) {
    return join(this.receiptsDir, id);
  }

  /** Deletes receipt rows for the given payments and schedules their files for removal. */
  private dropReceipts(paymentIds: string[]) {
    for (const pid of paymentIds) {
      for (const r of this.db.prepare('SELECT id FROM receipts WHERE payment_id = ?').all(pid) as { id: string }[]) this.pendingFileDeletes.push(r.id);
      this.db.prepare('DELETE FROM receipts WHERE payment_id = ?').run(pid);
    }
  }

  private paymentIdsOf(kind: 'template' | 'tracker', ownerId: string) {
    return (this.db.prepare('SELECT id FROM payments WHERE owner_kind = ? AND owner_id = ?').all(kind, ownerId) as { id: string }[]).map(r => r.id);
  }

  /** Removes files that have no database row (e.g. after a crash during upload). */
  private removeOrphanFiles() {
    const known = new Set((this.db.prepare('SELECT id FROM receipts').all() as { id: string }[]).map(r => r.id));
    for (const f of readdirSync(this.receiptsDir)) if (!known.has(f)) rmSync(join(this.receiptsDir, f), { force: true });
  }

  paymentExists(id: string) {
    return !!this.db.prepare('SELECT 1 FROM payments WHERE id = ?').get(id);
  }

  addReceipt(paymentId: string, file: { fileName: string; mime: string; data: Buffer }, user?: string): ReceiptMeta {
    if (!this.paymentExists(paymentId)) throw Object.assign(new Error('Zapis o plaćanju više ne postoji.'), { status: 404 });
    const meta: ReceiptMeta = {
      id: randomUUID().replace(/-/g, ''),
      fileName: cleanFileName(file.fileName, file.mime),
      mime: file.mime,
      size: file.data.length,
      ...(user ? { uploadedBy: user } : {}),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(this.receiptPath(meta.id), file.data);
    try {
      this.db.prepare('INSERT INTO receipts (id, payment_id, file_name, mime, size, uploaded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(meta.id, paymentId, meta.fileName, meta.mime, meta.size, user ?? null, meta.createdAt);
    } catch (e) {
      rmSync(this.receiptPath(meta.id), { force: true });
      throw e;
    }
    return meta;
  }

  getReceipt(id: string): ReceiptFile | undefined {
    const r = this.db.prepare('SELECT * FROM receipts WHERE id = ?').get(id) as any;
    return r && { ...rowToReceipt(r), paymentId: r.payment_id, path: this.receiptPath(r.id) };
  }

  deleteReceipt(id: string): boolean {
    return this.tx(() => {
      const res = this.db.prepare('DELETE FROM receipts WHERE id = ?').run(id);
      if (res.changes) this.pendingFileDeletes.push(id);
      return res.changes > 0;
    });
  }

  /** All receipts with their payment and owner, for the ZIP export. */
  allReceipts(): (ReceiptFile & { owner: string; period?: string; at: string; amountCents: number | null; currency: string })[] {
    const st = this.state();
    const out: ReturnType<Store['allReceipts']> = [];
    for (const o of [...st.templates, ...st.trackers]) {
      for (const p of o.payments) {
        for (const r of p.receipts ?? []) {
          out.push({ ...r, paymentId: p.id, path: this.receiptPath(r.id), owner: o.name, period: p.period, at: p.at, amountCents: p.amountCents, currency: p.currency });
        }
      }
    }
    return out;
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
    const receipts = new Map<string, ReceiptMeta[]>();
    for (const r of this.db.prepare('SELECT * FROM receipts ORDER BY created_at').all() as any[]) {
      (receipts.get(r.payment_id) ?? receipts.set(r.payment_id, []).get(r.payment_id)!).push(rowToReceipt(r));
    }
    const payments = new Map<string, Payment[]>();
    for (const r of this.db.prepare('SELECT id, owner_kind, owner_id, data, recorded_by FROM payments').all() as any[]) {
      const k = `${r.owner_kind}:${r.owner_id}`;
      const p: Payment = {
        ...JSON.parse(r.data),
        ...(r.recorded_by ? { recordedBy: r.recorded_by } : {}),
        ...(receipts.has(r.id) ? { receipts: receipts.get(r.id) } : {}),
      };
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
        this.dropReceipts(this.paymentIdsOf('template', op.id));
        this.db.prepare("DELETE FROM payments WHERE owner_kind = 'template' AND owner_id = ?").run(op.id);
        return this.db.prepare('DELETE FROM templates WHERE id = ?').run(op.id);
      case 'tracker.delete':
        this.dropReceipts(this.paymentIdsOf('tracker', op.id));
        this.db.prepare("DELETE FROM payments WHERE owner_kind = 'tracker' AND owner_id = ?").run(op.id);
        return this.db.prepare('DELETE FROM trackers WHERE id = ?').run(op.id);
      case 'payment.put': {
        // the owner may have been deleted by someone else in the meantime
        if (!this.ownerExists(op.owner)) return;
        const { recordedBy: _r, receipts: _rc, ...data } = op.payment;
        return this.db.prepare(
          `INSERT INTO payments (id, owner_kind, owner_id, data, recorded_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET owner_kind = excluded.owner_kind, owner_id = excluded.owner_id, data = excluded.data, updated_at = excluded.updated_at`,
        ).run(op.payment.id, op.owner.kind, op.owner.id, JSON.stringify(data), user ?? null, now);
      }
      case 'payment.delete':
        this.dropReceipts([op.id]);
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

function rowToReceipt(r: any): ReceiptMeta {
  return { id: r.id, fileName: r.file_name, mime: r.mime, size: r.size, ...(r.uploaded_by ? { uploadedBy: r.uploaded_by } : {}), createdAt: r.created_at };
}

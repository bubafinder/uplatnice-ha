import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/server/db';
import { diffState, emptyState, type AppState } from '../src/shared/state';
import type { Payment, Template } from '../src/shared/types';

const dir = mkdtempSync(join(tmpdir(), 'uplatnice-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
let n = 0;
const freshStore = () => new Store(join(dir, `t${n++}.db`));

const tpl = (id: string, extra: Partial<Template> = {}): Template => ({
  id, name: 'Nogomet', useProfile: true, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', payments: [], pauseMonths: [],
  slip: { amountCents: 4000, payer: { name: '', street: '', city: '' }, payee: { name: 'HNK Val', street: '', city: '', iban: 'HR1210010051863000160' }, model: 'HR00', reference: '', purpose: 'OTHR', description: 'Članarina {mm}/{gg}' },
  ...extra,
});
const pay = (id: string, period: string, cents = 4000): Payment => ({ id, period, at: period, amountCents: cents, currency: 'EUR', createdAt: `2026-10-0${n % 9}T00:00:00Z`, method: 'Aircash' });

test('empty database returns the default state', () => {
  const s = freshStore();
  const st = s.state();
  assert.deepEqual(st.templates, []);
  assert.ok(st.methods.includes('Aircash'));
  s.close();
});

test('diff → apply round-trips templates and payments, records the HA user', () => {
  const s = freshStore();
  const a = s.state();
  const b: AppState = { ...a, profile: { ...a.profile, name: 'Ivan Horvat' }, templates: [tpl('t1', { payments: [pay('p1', '2026-10')] })] };
  s.apply(diffState(a, b), 'Ivan');
  const st = s.state();
  assert.equal(st.profile.name, 'Ivan Horvat');
  assert.equal(st.templates[0].slip.description, 'Članarina {mm}/{gg}');
  assert.equal(st.templates[0].payments[0].recordedBy, 'Ivan');
  // recordedBy is ignored by the diff, so the round-trip is clean
  assert.deepEqual(diffState(st, { ...st }), []);
  s.close();
});

test('concurrent edits on different items do not overwrite each other', () => {
  const s = freshStore();
  const base = s.state();
  const withTpl = { ...base, templates: [tpl('t1')] };
  s.apply(diffState(base, withTpl));
  const synced = s.state();
  // user A adds a payment, user B renames the template, both starting from the same state
  const a = { ...synced, templates: [{ ...synced.templates[0], payments: [pay('pa', '2026-11')] }] };
  const b = { ...synced, templates: [{ ...synced.templates[0], name: 'Nogomet – Luka' }] };
  s.apply(diffState(synced, a), 'Ana');
  s.apply(diffState(synced, b), 'Ivan');
  const t = s.state().templates[0];
  assert.equal(t.name, 'Nogomet – Luka');
  assert.equal(t.payments.length, 1);
  assert.equal(t.payments[0].recordedBy, 'Ana');
  s.close();
});

test('deleting a template deletes its payments; payments for missing owners are ignored', () => {
  const s = freshStore();
  const base = s.state();
  const st1 = { ...base, templates: [tpl('t1', { payments: [pay('p1', '2026-09'), pay('p2', '2026-10')] })] };
  s.apply(diffState(base, st1));
  s.apply([{ type: 'template.delete', id: 't1' }]);
  s.apply([{ type: 'payment.put', owner: { kind: 'template', id: 't1' }, payment: pay('p3', '2026-11') }]);
  const st = s.state();
  assert.equal(st.templates.length, 0);
  s.close();
});

test('backup import merges without duplicates and keeps existing profile', () => {
  const s = freshStore();
  s.apply([{ type: 'profile', profile: { name: 'Ana', street: '', city: '', iban: '' } }]);
  const backup = {
    version: 2,
    profile: { name: 'Ivan', street: 'Ilica 1', city: '10000 Zagreb', iban: '' },
    templates: [tpl('t1', { payments: [pay('p1', '2025-01'), pay('p2', '2025-02')] })],
    trackers: [{ id: 'r1', name: 'Struja', createdAt: '', updatedAt: '', pauseMonths: [], payments: [{ ...pay('p3', '2022-01', 47789), currency: 'HRK' }] }],
    methods: ['Aircash', 'Revolut'],
  };
  assert.deepEqual(s.importBackup(backup, 'Ivan'), { templates: 1, trackers: 1, payments: 3 });
  assert.deepEqual(s.importBackup(backup, 'Ivan'), { templates: 0, trackers: 0, payments: 0 });
  const st = s.state();
  assert.equal(st.profile.name, 'Ana');
  assert.ok(st.methods.includes('Revolut'));
  assert.equal(st.trackers[0].payments[0].currency, 'HRK');
  assert.throws(() => s.importBackup({ foo: 1 }), /sigurnosna kopija/);
  s.close();
});

test('v1 backup from the standalone app imports', () => {
  const s = freshStore();
  const v1 = { version: 1, profile: { name: 'Ivan' }, templates: [{ ...tpl('old'), payments: undefined, pauseMonths: undefined }] };
  assert.equal(s.importBackup(v1).templates, 1);
  assert.deepEqual(s.state().templates[0].payments, []);
  assert.deepEqual(emptyState().templates, []);
  s.close();
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseNotes, parseNotesLine } from '../src/shared/notesImport';
import { groupByYear, missingMonths, parsePeriodInput, statusFor, shortYm } from '../src/shared/history';
import { fillPlaceholders } from '../src/shared/placeholders';
import { suggestPlaceholders } from '../src/web/ui/draft';
import { DEFAULT_METHODS, migrateBackup } from '../src/shared/state';
import type { Payment } from '../src/shared/types';

const M = DEFAULT_METHODS;

// real list from the user's notes
const NOTES = `09/24 - 30
10/24 - 30
11/24 - 30 aircash
12/24 - 30 aircash
04/25 - 30 aircash
05/25 - 30 aircash
06/25 - 30 aircash
09/25 - 30 aircash
10/25 - 30 aircash
Razlika za 9 i 10 - 20eur aircash
11/25 - 40 aircash
12/25 - 40 aircash
01/26 - 40 aircash

02/26 - 40 aircash
03/26 - 40 aircash
04/26 - 40 aircash
05/26 - 40 aircash
09/26 - 40 aircash
10/26 - 40 aircash
11/26 - 40 aircash`;

test('notes import: typical lines', () => {
  const r = parseNotes(NOTES, M);
  assert.equal(r.length, 20);
  assert.ok(r.every(x => x.ok));
  assert.deepEqual({ ...r[0] }, { raw: '09/24 - 30', ok: true, period: '2024-09', amountCents: 3000, currency: 'EUR', method: undefined, note: undefined });
  assert.equal(r[2].method, 'Aircash');
  assert.equal(r[19].period, '2026-11');
  const razlika = r[9];
  assert.equal(razlika.period, undefined);
  assert.equal(razlika.amountCents, 2000);
  assert.equal(razlika.method, 'Aircash');
  assert.equal(razlika.note, 'Razlika za 9 i 10');
});

test('notes import: other formats', () => {
  assert.deepEqual(
    (({ period, amountCents, currency }) => ({ period, amountCents, currency }))(parseNotesLine('01/22 - 477,89 KN', M)!),
    { period: '2022-01', amountCents: 47789, currency: 'HRK' });
  assert.equal(parseNotesLine('2/22 66.33', M)!.amountCents, 6633);
  assert.equal(parseNotesLine('2/22 66.33', M)!.period, '2022-02');
  assert.equal(parseNotesLine('02/24 - 44,39', M)!.amountCents, 4439);
  assert.equal(parseNotesLine('✅ 05/25 - 30 aircash', M)!.period, '2025-05');
  assert.equal(parseNotesLine('- [x] 06/25 - 30 gotovina', M)!.method, 'Gotovina');
  assert.equal(parseNotesLine('07/25 - 30 platio tata', M)!.note, 'platio tata');
  assert.equal(parseNotesLine('08/25 - 1.234,50 € trajni nalog', M)!.method, 'Trajni nalog');
  assert.equal(parseNotesLine('08/25 - 1.234,50 € trajni nalog', M)!.amountCents, 123450);
  assert.equal(parseNotesLine('nešto bez iznosa', M)!.ok, false);
  assert.equal(parseNotesLine('   ', M), null);
});

const pay = (period: string | undefined, cents: number, extra: Partial<Payment> = {}): Payment =>
  ({ id: Math.random().toString(), period, at: period ?? '2025-10', amountCents: cents, currency: 'EUR', createdAt: new Date().toISOString(), ...extra });

test('missing months with pause months', () => {
  const ps = [pay('2026-05', 4000), pay('2026-09', 4000)];
  assert.deepEqual(missingMonths(ps, [], '2026-10'), ['2026-06', '2026-07', '2026-08', '2026-10']);
  assert.deepEqual(missingMonths(ps, [7, 8], '2026-10'), ['2026-06', '2026-10']);
  assert.deepEqual(missingMonths([], [], '2026-10'), []);
});

test('grouping and yearly totals', () => {
  const ps = [pay('2025-11', 4000), pay('2025-12', 4000), pay('2026-01', 4000), pay('2022-01', 47789, { currency: 'HRK' })];
  const g = groupByYear(ps, [], '2026-01');
  assert.deepEqual(g.map(x => x.year), [2026, 2025, 2024, 2023, 2022]);
  assert.equal(g[1].totals.EUR, 8000);
  assert.equal(g[4].totals.HRK, 47789);
  assert.equal(g[1].count, 2);
});

test('monthly status', () => {
  const ps = [pay('2026-10', 4000)];
  assert.deepEqual(statusFor(ps, [], '2026-10'), { kind: 'paid', cents: 4000, currency: 'EUR' });
  assert.deepEqual(statusFor(ps, [7, 8], '2026-07'), { kind: 'pause' });
  assert.deepEqual(statusFor(ps, [], '2026-11'), { kind: 'unpaid' });
});

test('period parsing, {gg} and suggestions', () => {
  assert.equal(parsePeriodInput('5/25'), '2025-05');
  assert.equal(parsePeriodInput('13/25'), null);
  assert.equal(shortYm('2025-05'), '05/25');
  assert.equal(fillPlaceholders('Clanarina za Luka Lovric {mm}/{gg}', { year: 2026, month: 11 }), 'Clanarina za Luka Lovric 11/26');
  assert.deepEqual(suggestPlaceholders('Clanarina za Luka Lovric 05/25', { year: 2026, month: 10 }),
    { text: 'Clanarina za Luka Lovric {mm}/{gg}', period: { year: 2025, month: 5 } });
});

test('backup migration v1 → current', () => {
  const s = migrateBackup({ version: 1, profile: { name: 'A' }, templates: [{ id: 'x', name: 'N', slip: {}, useProfile: true }] });
  assert.deepEqual(s.templates[0].payments, []);
  assert.deepEqual(s.trackers, []);
  assert.ok(s.methods.includes('Aircash'));
  assert.equal(s.profile.street, '');
});

test('long runs of empty months are collapsed', () => {
  const g = groupByYear([pay('2022-01', 100), pay('2022-12', 100)], [], '2022-12');
  const kinds = g[0].rows.map(r => r.kind);
  assert.deepEqual(kinds, ['payment', 'gap', 'payment']);
  const gap = g[0].rows[1] as { kind: 'gap'; from: string; to: string; count: number };
  assert.deepEqual([gap.from, gap.to, gap.count], ['2022-02', '2022-11', 10]);
  const g2 = groupByYear([pay('2022-01', 100), pay('2022-04', 100)], [], '2022-04');
  assert.deepEqual(g2[0].rows.map(r => r.kind), ['payment', 'missing', 'missing', 'payment']);
});

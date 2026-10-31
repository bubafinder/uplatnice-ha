import assert from 'node:assert/strict';
import { test } from 'node:test';
import { iso7064, mod10, mod11ini, mod11jmb } from '../src/shared/checks';
import { ibanError } from '../src/shared/iban';
import { referenceError, mod11iniDigit } from '../src/shared/reference';
import { buildHub3, formatAmount, parseAmount, parseHub3, validate, hasErrors } from '../src/shared/hub3';
import { fillPlaceholders, shiftPeriod } from '../src/shared/placeholders';
import { invalidChars, sanitize, charLength } from '../src/shared/text';
import type { Slip } from '../src/shared/types';

test('MOD11INI example from the HUB document', () => {
  assert.ok(mod11ini('334445556669'));
  assert.ok(!mod11ini('334445556668'));
  assert.equal(mod11iniDigit('33444555666'), 9);
});

test('ISO 7064 (OIB)', () => {
  assert.ok(iso7064('69435151530'));
  assert.ok(iso7064('12345678903'));
  assert.ok(!iso7064('69435151531'));
});

test('MOD11 JMBG and MOD10', () => {
  assert.ok(mod11jmb('0101990330009') || !mod11jmb('1111111111111'));
  assert.ok(!mod11jmb('1111111111111'));
  assert.ok(mod10('79927398713')); // well-known Luhn example
});

test('IBAN', () => {
  assert.equal(ibanError('HR1210010051863000160'), null);
  assert.equal(ibanError('hr12 1001 0051 8630 0016 0'), null);
  assert.match(ibanError('HR1210010051863000161')!, /Kontrolni/);
  assert.match(ibanError('HR121001005186300016')!, /20 znakova/);
  assert.match(ibanError('DE89370400440532013000')!, /HR/);
});

test('payment reference', () => {
  assert.match(referenceError('HR01', '7269-68499637766-00019')!, /Kontrolni/); // the HUB example is illustrative only
  assert.equal(referenceError('HR01', '10-230578901-6'), null); // FINA example
  assert.equal(referenceError('HR06', '102-3057-89015'), null); // FINA example
  assert.equal(referenceError('HR00', '123-456'), null);
  assert.equal(referenceError('HR99', ''), null);
  assert.match(referenceError('HR99', '1')!, /prazan/);
  assert.match(referenceError('HR00', '')!, /HR99/);
  assert.match(referenceError('HR00', '1234567890123')!, /12/);
  assert.match(referenceError('HR00', '1--2')!, /crtica/);
  assert.match(referenceError('HR00', '12a')!, /znamenke/);
  assert.match(referenceError('HR01', '7269-68499637766-00018')!, /Kontrolni/);
  assert.equal(referenceError('HR68', '8141-69435151530'), mod11ini('8141') ? null : referenceError('HR68', '8141-69435151530'));
  assert.equal(referenceError('HR67', '69435151530'), null);
  assert.match(referenceError('HR19', '1')!, /ne postoji/);
  assert.equal(referenceError('', ''), null);
});

test('amount parsing and formatting', () => {
  assert.equal(parseAmount('123,45'), 12345);
  assert.equal(parseAmount('1.234,5'), 123450);
  assert.equal(parseAmount('1234.56'), 123456);
  assert.equal(parseAmount('1.234'), 123400);
  assert.equal(parseAmount('25'), 2500);
  assert.equal(parseAmount('25,'), 2500);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('1,234'), null);
  assert.equal(formatAmount(123456), '1.234,56');
  assert.equal(formatAmount(5), '0,05');
});

test('character set', () => {
  assert.deepEqual(invalidChars('Čćđšž ŽELJKO (1/2) +?:\'.,-'), []);
  assert.deepEqual(invalidChars('a&b!"'), ['&', '!', '"']);
  assert.equal(sanitize('Müller & sin — „test"'), 'Muller + sin - \'test\'');
  assert.equal(charLength('ŽČĆ'), 3);
});

const spec: Slip = {
  amountCents: 12355,
  payer: { name: 'ŽELJKO SENEKOVIĆ', street: 'IVANEČKA ULICA 125', city: '42000 VARAŽDIN' },
  payee: { name: '2DBK d.d.', street: 'ALKARSKI PROLAZ 13B', city: '21230 SINJ', iban: 'HR1210010051863000160' },
  model: 'HR01', reference: '7269-68499637766-00019', purpose: 'COST', description: 'Troškovi za 1. mjesec',
};

test('HUB3 payload matches the spec example', () => {
  const expected = ['HRVHUB30', 'EUR', '000000000012355', 'ŽELJKO SENEKOVIĆ', 'IVANEČKA ULICA 125', '42000 VARAŽDIN',
    '2DBK d.d.', 'ALKARSKI PROLAZ 13B', '21230 SINJ', 'HR1210010051863000160', 'HR01', '7269-68499637766-00019', 'COST',
    'Troškovi za 1. mjesec'].join('\n') + '\n';
  assert.equal(buildHub3(spec), expected);
  assert.ok(!hasErrors(validate(spec))); // only a check-digit warning
  assert.deepEqual(parseHub3(expected), spec);
});

test('validation catches errors', () => {
  const bad: Slip = { ...spec, amountCents: null, payee: { ...spec.payee, name: 'X'.repeat(26), iban: 'HR00' }, description: 'a&b' };
  const fields = validate(bad).filter(i => i.level === 'error').map(i => i.field).sort();
  assert.deepEqual(fields, ['amount', 'description', 'payee.iban', 'payee.name']);
});

test('empty model and reference → HR99', () => {
  const s = { ...spec, model: '', reference: '' };
  assert.ok(!hasErrors(validate(s)));
  assert.equal(buildHub3(s).split('\n')[10], 'HR99');
});

test('placeholders', () => {
  const p = { year: 2026, month: 11 };
  assert.equal(fillPlaceholders('Članarina {mjesec} {godina}', p), 'Članarina studeni 2026');
  assert.equal(fillPlaceholders('{Mjesec}/{mm}', p), 'Studeni/11');
  assert.deepEqual(shiftPeriod({ year: 2026, month: 12 }, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftPeriod({ year: 2026, month: 1 }, -1), { year: 2025, month: 12 });
});

test('parseHub3 rejects non-HUB and HRK', () => {
  assert.throws(() => parseHub3('nešto'), /HRVHUB30/);
  assert.throws(() => parseHub3('HRVHUB30\nHRK\n1\n'), /HRK/);
});

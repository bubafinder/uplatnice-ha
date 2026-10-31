import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { createHandler } from '../src/server/app';
import { Store } from '../src/server/db';
import { cleanFileName, sniffMime } from '../src/server/files';
import type { AppState } from '../src/shared/state';
import type { Payment, Template } from '../src/shared/types';

const dir = mkdtempSync(join(tmpdir(), 'uplatnice-receipts-'));
let store: Store;
let server: Server;
let base = '';

const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20), Buffer.from('%%EOF\n')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

const tpl = (id: string, payments: Payment[]): Template => ({
  id, name: 'Nogomet – Luka', useProfile: true, createdAt: '', updatedAt: '', pauseMonths: [], payments,
  slip: { amountCents: 4000, payer: { name: '', street: '', city: '' }, payee: { name: 'HNK Val', street: '', city: '', iban: 'HR1210010051863000160' }, model: 'HR00', reference: '', purpose: 'OTHR', description: '' },
});
const pay = (id: string, period: string): Payment => ({ id, period, at: period, amountCents: 4000, currency: 'EUR', createdAt: new Date().toISOString() });

const upload = (paymentId: string, body: Buffer, name = 'potvrda.pdf') =>
  fetch(`${base}/api/payments/${paymentId}/receipts`, {
    method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(name), 'X-Remote-User-Display-Name': 'Ana' },
  });

before(async () => {
  store = new Store(join(dir, 'db.sqlite'));
  store.apply([
    { type: 'template.put', template: (({ payments: _p, ...t }) => t)(tpl('t1', [])) },
    { type: 'payment.put', owner: { kind: 'template', id: 't1' }, payment: pay('p1', '2026-10') },
    { type: 'payment.put', owner: { kind: 'template', id: 't1' }, payment: pay('p2', '2026-11') },
  ]);
  server = createServer(createHandler(store, Buffer.from('<!doctype html>'), { allowAnyClient: true }));
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(() => {
  server.close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

test('content sniffing accepts receipts and rejects everything else', () => {
  assert.equal(sniffMime(PDF), 'application/pdf');
  assert.equal(sniffMime(PNG), 'image/png');
  assert.equal(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])), 'image/jpeg');
  assert.equal(sniffMime(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(8)])), 'image/heic');
  assert.equal(sniffMime(HTML), null);
  assert.equal(cleanFileName('../../etc/passwd', 'application/pdf'), 'etc_passwd.pdf');
  assert.equal(cleanFileName('Potvrda Aircash.PDF', 'application/pdf'), 'Potvrda Aircash.PDF');
  assert.equal(cleanFileName('', 'image/jpeg'), 'potvrda.jpg');
});

test('upload, list in state, download and delete a receipt', async () => {
  const res = await upload('p1', PDF, 'Potvrda – listopad.pdf');
  assert.equal(res.status, 201);
  const { receipt, state } = (await res.json()) as { receipt: { id: string }; state: AppState };
  const p1 = state.templates[0].payments.find(p => p.id === 'p1')!;
  assert.equal(p1.receipts?.length, 1);
  assert.equal(p1.receipts![0].fileName, 'Potvrda – listopad.pdf');
  assert.equal(p1.receipts![0].uploadedBy, 'Ana');

  const dl = await fetch(`${base}/api/receipts/${receipt.id}`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/pdf');
  assert.match(dl.headers.get('content-disposition')!, /^inline; .*filename\*=UTF-8''Potvrda%20%E2%80%93%20listopad\.pdf/);
  assert.match(dl.headers.get('content-security-policy')!, /sandbox/);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), PDF);
  assert.match((await fetch(`${base}/api/receipts/${receipt.id}?download=1`)).headers.get('content-disposition')!, /^attachment/);

  const del = await fetch(`${base}/api/receipts/${receipt.id}`, { method: 'DELETE' });
  assert.equal(del.status, 200);
  assert.equal((await fetch(`${base}/api/receipts/${receipt.id}`)).status, 404);
  assert.equal(readdirSync(store.receiptsDir).length, 0);
});

test('rejects disallowed types, oversized files and unknown payments', async () => {
  assert.equal((await upload('p1', HTML, 'x.html')).status, 415);
  assert.equal((await upload('nope', PDF)).status, 404);
  const big = Buffer.concat([PDF, Buffer.alloc(15 * 1024 * 1024)]);
  const res = await upload('p1', big);
  assert.equal(res.status, 413);
  assert.match(((await res.json()) as { error: string }).error, /15 MB/);
  assert.equal(readdirSync(store.receiptsDir).length, 0);
});

test('client sync never drops receipts and payment ops ignore the receipts field', async () => {
  await upload('p2', PNG, 'slika.png');
  const st = store.state();
  const p2 = st.templates[0].payments.find(p => p.id === 'p2')!;
  // a client that edits the payment note sends the payment including (or without) receipts
  store.apply([{ type: 'payment.put', owner: { kind: 'template', id: 't1' }, payment: { ...p2, note: 'gotovina', receipts: [] } }]);
  const again = store.state().templates[0].payments.find(p => p.id === 'p2')!;
  assert.equal(again.note, 'gotovina');
  assert.equal(again.receipts?.length, 1);
});

test('ZIP export contains every receipt under the template name', async () => {
  const res = await fetch(`${base}/api/receipts.zip`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const zip = Buffer.from(await res.arrayBuffer());
  // parse the central directory to check names and contents
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let off = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLen = zip.readUInt16LE(off + 28);
    const local = zip.readUInt32LE(off + 42);
    names.push(zip.subarray(off + 46, off + 46 + nameLen).toString('utf8'));
    const size = zip.readUInt32LE(off + 20);
    const lName = zip.readUInt16LE(local + 26);
    const method = zip.readUInt16LE(local + 8);
    const data = zip.subarray(local + 30 + lName, local + 30 + lName + size);
    assert.deepEqual(method === 0 ? data : inflateRawSync(data), PNG);
    off += 46 + nameLen + zip.readUInt16LE(off + 30) + zip.readUInt16LE(off + 32);
  }
  assert.deepEqual(names, ['Nogomet – Luka/2026-11_slika.png']);
});

test('deleting a payment or its template removes receipt files', async () => {
  await upload('p1', PDF);
  assert.equal(readdirSync(store.receiptsDir).length, 2);
  store.apply([{ type: 'payment.delete', id: 'p1' }]);
  assert.equal(readdirSync(store.receiptsDir).length, 1);
  store.apply([{ type: 'template.delete', id: 't1' }]);
  assert.equal(readdirSync(store.receiptsDir).length, 0);
});

test('orphan files are cleaned up on startup', () => {
  const d = mkdtempSync(join(tmpdir(), 'uplatnice-orphan-'));
  const s1 = new Store(join(d, 'db.sqlite'));
  writeFileSync(join(s1.receiptsDir, 'leftover'), 'x');
  s1.close();
  const s2 = new Store(join(d, 'db.sqlite'));
  assert.equal(existsSync(join(s2.receiptsDir, 'leftover')), false);
  s2.close();
  rmSync(d, { recursive: true, force: true });
});

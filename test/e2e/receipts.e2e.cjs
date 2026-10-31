// End-to-end test for payment confirmations, through the Ingress mock (app inside an iframe).
// Usage: start the server (ALLOW_ANY_CLIENT=1, empty DB) and test/e2e/ingress-proxy.mjs, then:
//   PLAYWRIGHT_PATH=... node test/e2e/receipts.e2e.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT = process.env.OUT_DIR ?? '/tmp/e2e-receipts';
const BASE = 'http://127.0.0.1:8123';
const API = `${BASE}/api/hassio_ingress/dev-token-123/api`;
const FIX = path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

// fixtures created at runtime so the repository stays small
const BIG_PHOTO = path.join(OUT, 'big-photo.jpg');
const HTML_FILE = path.join(OUT, 'not-a-receipt.html');

const now = new Date().toISOString();
const ym = now.slice(0, 7);
const template = {
  id: 'e2e-tpl', name: 'Nogomet – Luka', useProfile: true, createdAt: now, updatedAt: now, pauseMonths: [],
  slip: { amountCents: 4000, payer: { name: '', street: '', city: '' }, payee: { name: 'HNK Val', street: 'Vukovarska 34', city: '21216 Kaštel Stari', iban: 'HR1210010051863000160' }, model: 'HR00', reference: '', purpose: 'OTHR', description: 'Članarina {mm}/{gg}' },
};
const seedPayment = { id: 'e2e-pay-1', period: '2026-09', at: '2026-09', amountCents: 4000, currency: 'EUR', createdAt: now, method: 'Aircash' };

function zipNames(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let off = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const n = buf.readUInt16LE(off + 28);
    names.push(buf.subarray(off + 46, off + 46 + n).toString('utf8'));
    off += 46 + n + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
  return names;
}

const step = (name) => console.log(`✓ ${name}`);

(async () => {
  // a ~5 MB noisy JPEG that should be shrunk before upload
  if (!fs.existsSync(BIG_PHOTO)) {
    const sharp = require(process.env.SHARP_PATH ?? 'sharp');
    const raw = require('node:crypto').randomBytes(2400 * 3200 * 3);
    await sharp(raw, { raw: { width: 2400, height: 3200, channels: 3 } }).blur(1.2).jpeg({ quality: 92 }).toFile(BIG_PHOTO);
  }
  fs.writeFileSync(HTML_FILE, '<html><script>alert(1)</script></html>');

  await fetch(`${API}/ops`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ops: [
      { type: 'profile', profile: { name: 'Ivan Horvat', street: 'Ilica 12', city: '10000 Zagreb', iban: '' } },
      { type: 'template.put', template },
      { type: 'payment.put', owner: { kind: 'template', id: template.id }, payment: seedPayment },
    ] }),
  });

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 }, acceptDownloads: true });
  await ctx.addCookies([{ name: 'ha_user', value: 'Ana', url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${BASE}/hassio/ingress/uplatnice`);
  const app = page.frameLocator('#ingress');
  const toast = app.locator('.toast.is-on');

  // 1. existing payment shows "bez potvrde"; add a PDF from the receipts dialog
  await app.locator('.top-nav button:has-text("Predlošci")').click();
  await app.locator('.tpl-main').first().click();
  const row = app.locator('tr', { hasText: '09/26' });
  await row.locator('.no-receipt').click();
  await app.locator('.receipts-modal').waitFor();
  await app.locator('[data-testid=receipts-dialog-input]').setInputFiles(path.join(FIX, 'receipt.pdf'));
  await app.locator('.receipt-list li').first().waitFor();
  await app.locator('.pdf-page').first().waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/01-pdf-preview.png` });
  step('PDF receipt uploads and renders in the dialog');

  // 2. a disallowed file is rejected with a clear message
  await app.locator('[data-testid=receipts-dialog-input]').setInputFiles(HTML_FILE);
  await toast.filter({ hasText: 'Potvrda nije spremljena' }).waitFor();
  assert.equal(await app.locator('.receipt-list li').count(), 1);
  step('HTML file is rejected');

  // 3. a large photo is shrunk before upload
  await app.locator('[data-testid=receipts-dialog-input]').setInputFiles(BIG_PHOTO);
  await app.locator('.receipt-list li').nth(1).waitFor({ timeout: 30000 });
  await app.locator('.receipt-img').waitFor();
  let state = await (await fetch(`${API}/state`)).json();
  const receipts = state.templates[0].payments.find(p => p.id === seedPayment.id).receipts;
  const photo = receipts.find(r => r.mime === 'image/jpeg');
  assert.ok(photo, 'photo stored');
  assert.ok(photo.size < fs.statSync(BIG_PHOTO).size / 2, `photo shrunk: ${photo.size} < ${fs.statSync(BIG_PHOTO).size}`);
  assert.equal(photo.uploadedBy, 'Ana');
  await page.screenshot({ path: `${OUT}/02-photo-preview.png` });
  step(`large photo shrunk from ${(fs.statSync(BIG_PHOTO).size / 1e6).toFixed(1)} MB to ${(photo.size / 1e6).toFixed(2)} MB`);

  // 4. delete one receipt
  await app.locator('.receipt-actions button:has-text("Obriši…")').click();
  await app.locator('.receipt-actions button:has-text("Obriši potvrdu")').click();
  await toast.filter({ hasText: 'Potvrda je obrisana' }).waitFor();
  assert.equal(await app.locator('.receipt-list li').count(), 1);
  await app.locator('.receipts-head button:has-text("Zatvori")').click();
  assert.equal((await row.locator('.receipt-btn').textContent()).trim(), '📎 1');
  step('receipt deleted; row shows 📎 1');

  // 5. quick entry from the slip with a receipt attached in the same step
  await app.locator('button:has-text("Otvori uplatnicu")').click();
  await app.locator('.code-btn svg').waitFor();
  await app.locator('.actions button:has-text("Zabilježi plaćanje")').click();
  await app.locator('[data-testid=receipt-input]').setInputFiles(path.join(FIX, 'receipt.pdf'));
  await app.locator('.picked li').waitFor();
  await page.screenshot({ path: `${OUT}/03-quick-entry.png` });
  await app.locator('.modal button.primary').click();
  await app.locator('tr.is-new').waitFor();
  await toast.filter({ hasText: 'Potvrda je spremljena' }).waitFor({ timeout: 20000 });
  assert.equal((await app.locator('tr.is-new .receipt-btn').textContent()).trim(), '📎 1');
  await page.screenshot({ path: `${OUT}/04-history.png`, fullPage: true });
  step('quick entry stores the payment and its receipt');

  // 6. ZIP export
  state = await (await fetch(`${API}/state`)).json();
  const total = state.templates[0].payments.reduce((a, p) => a + (p.receipts?.length ?? 0), 0);
  await app.locator('.top-nav button:has-text("Moj profil")').click();
  const [dl] = await Promise.all([page.waitForEvent('download'), app.locator('a:has-text("Preuzmi sve potvrde (ZIP)")').click()]);
  const zipPath = path.join(OUT, dl.suggestedFilename());
  await dl.saveAs(zipPath);
  const names = zipNames(fs.readFileSync(zipPath));
  assert.equal(names.length, total);
  assert.ok(names.every(n => n.startsWith('Nogomet – Luka/')), names.join(', '));
  step(`ZIP contains ${names.length} receipts: ${names.join(', ')}`);

  // 7. deleting the payment also removes its receipts
  await app.locator('.top-nav button:has-text("Predlošci")').click();
  await app.locator('.tpl-main').first().click();
  await row.locator('button:has-text("Uredi")').click();
  await app.locator('.modal button:has-text("Obriši zapis…")').click();
  await app.locator('.modal button:has-text("Obriši zapis i potvrde (1)")').click();
  await page.waitForTimeout(1200);
  state = await (await fetch(`${API}/state`)).json();
  assert.equal(state.templates[0].payments.some(p => p.id === seedPayment.id), false);
  step('deleting a payment deletes its receipts');

  // 8. mobile layout of the receipts dialog
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const mpage = await mctx.newPage();
  await mpage.goto(`${BASE}/hassio/ingress/uplatnice`);
  const mapp = mpage.frameLocator('#ingress');
  await mapp.locator('.bottom-nav button:has-text("Predlošci")').click();
  await mapp.locator('.tpl-main').first().click();
  await mapp.locator('.receipt-btn').first().click();
  await mapp.locator('.pdf-page').first().waitFor({ timeout: 20000 });
  await mpage.screenshot({ path: `${OUT}/05-mobile-dialog.png` });
  step('receipts dialog works on mobile');

  assert.deepEqual(errors, []);
  console.log('All receipt checks passed.');
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});

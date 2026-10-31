// Mobile layout check: every page and dialog at phone width, through the Ingress mock.
// Two environments are emulated:
//   - Safari: a floating toolbar covers the bottom of the screen (an overlay in the outer page)
//   - Home Assistant iOS app: the Ingress iframe grows to its content height
// For each screen the test checks that the navigation is visible and not covered, nothing overflows
// horizontally, and the screen's main action can be scrolled into the uncovered area.
// Usage: start the server (ALLOW_ANY_CLIENT=1, empty DB) and test/e2e/ingress-proxy.mjs, then run this file.
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const OUT = process.env.OUT_DIR ?? '/tmp/e2e-mobile';
const BASE = 'http://127.0.0.1:8123';
const API = `${BASE}/api/hassio_ingress/dev-token-123/api`;
const VIEWPORT = { width: 390, height: 844 };
const TOOLBAR = 110; // px covered by the emulated Safari toolbar
fs.mkdirSync(OUT, { recursive: true });

const now = new Date().toISOString();
const slip = (i, name) => ({
  amountCents: 4000 + i, payer: { name: '', street: '', city: '' },
  payee: { name, street: 'Vukovarska 34', city: '21216 Kaštel Stari', iban: 'HR1210010051863000160' },
  model: 'HR00', reference: '', purpose: 'OTHR', description: 'Članarina za Luku Lovrića {mm}/{gg}',
});
const payments = Array.from({ length: 14 }, (_, i) => {
  const m = String((i % 12) + 1).padStart(2, '0');
  const period = `${i < 12 ? 2025 : 2026}-${m}`;
  return { id: `mp-${i}`, period, at: period, amountCents: 4000, currency: 'EUR', createdAt: now, method: 'Aircash', note: i === 3 ? 'Dugačka napomena koja ne smije razvući karticu preko ruba ekrana' : undefined };
});
const templates = [
  { id: 'm-1', name: 'Luka – nogomet HNK Val Kaštel Stari (dugačak naziv)', slip: slip(0, 'HNK Val'), payments },
  ...Array.from({ length: 7 }, (_, i) => ({ id: `m-${i + 2}`, name: `Predložak ${i + 2}`, slip: slip(i + 1, `Primatelj ${i + 2}`), payments: [] })),
].map(t => ({ useProfile: true, createdAt: now, updatedAt: now, pauseMonths: [7, 8], ...t }));

const step = name => console.log(`✓ ${name}`);

async function seed() {
  const ops = [{ type: 'profile', profile: { name: 'Ivan Horvat', street: 'Ilica 12', city: '10000 Zagreb', iban: '' } }];
  for (const t of templates) {
    const { payments: ps, ...rest } = t;
    ops.push({ type: 'template.put', template: rest });
    for (const p of ps) ops.push({ type: 'payment.put', owner: { kind: 'template', id: t.id }, payment: p });
  }
  ops.push({ type: 'tracker.put', tracker: { id: 'm-tr', name: 'Struja', createdAt: now, updatedAt: now, pauseMonths: [] } });
  ops.push({ type: 'payment.put', owner: { kind: 'tracker', id: 'm-tr' }, payment: { id: 'm-tr-1', period: '2022-01', at: '2022-01', amountCents: 47789, currency: 'HRK', createdAt: now } });
  const res = await fetch(`${API}/ops`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops }) });
  assert.equal(res.status, 200);
}

/** Elements inside the app that stick out past the right edge (ignoring content of scroll containers). */
const overflowing = () => {
  const w = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= w + 1) continue;
    let inScroller = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === 'auto' || ox === 'scroll') && p.scrollWidth > p.clientWidth) { inScroller = true; break; }
    }
    if (!inScroller) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} → ${Math.round(r.right)}px`);
  }
  return { docWidth: document.documentElement.scrollWidth, width: w, bad: bad.slice(0, 8) };
};

async function run(browser, mode) {
  const ctx = await browser.newContext({ viewport: VIEWPORT, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${BASE}/hassio/ingress/uplatnice`);
  if (mode === 'safari') {
    await page.evaluate(h => {
      const bar = document.createElement('div');
      bar.id = 'safari-toolbar';
      bar.style.cssText = `position:fixed;left:0;right:0;bottom:0;height:${h}px;background:rgba(40,40,40,.85);z-index:10;pointer-events:none`;
      document.body.appendChild(bar);
    }, TOOLBAR);
  }
  const app = page.frameLocator('#ingress');
  const frame = () => page.frames().find(f => f.url().includes('hassio_ingress'));
  await app.locator('.top').waitFor();

  const growIframe = async () => {
    if (mode !== 'ios-app') return;
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => {
        const f = document.getElementById('ingress');
        const d = f.contentDocument;
        f.style.height = `${Math.max(d.documentElement.scrollHeight, d.body.scrollHeight)}px`;
      });
      await page.waitForTimeout(80);
    }
  };

  /** Checks one screen; `action` is a locator for the main button that must be reachable. */
  async function check(label, action) {
    await page.waitForTimeout(250);
    await growIframe();
    const frameBox = await page.locator('#ingress').boundingBox();
    const visibleBottom = VIEWPORT.height - (mode === 'safari' ? TOOLBAR : 0);

    const nav = await app.locator('.mobile-nav').boundingBox();
    assert.ok(nav, `${mode}/${label}: navigation rendered`);
    const navTop = frameBox.y + nav.y;
    assert.ok(navTop >= 0 && navTop + nav.height <= visibleBottom, `${mode}/${label}: navigation on screen (top ${Math.round(navTop)})`);

    const o = await frame().evaluate(overflowing);
    assert.ok(o.docWidth <= o.width + 1 && o.bad.length === 0, `${mode}/${label}: horizontal overflow ${JSON.stringify(o)}`);

    if (action) {
      await action.scrollIntoViewIfNeeded();
      await page.waitForTimeout(100);
      const b = await action.boundingBox();
      assert.ok(b, `${mode}/${label}: action rendered`);
      if (mode !== 'ios-app') {
        // scrolling must be able to lift the action above the toolbar
        await action.evaluate(el => el.scrollIntoView({ block: 'center' }));
        const c = await action.boundingBox();
        assert.ok(frameBox.y + c.y + c.height <= visibleBottom, `${mode}/${label}: action can be scrolled above the toolbar`);
      }
    }
    const file = `${OUT}/${mode}-${label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
    await page.screenshot({ path: file });
    step(`${mode}: ${label}`);
  }

  const nav = name => app.locator(`.mobile-nav button:has-text("${name}")`).click();
  const modal = app.locator('.modal');

  // Uplatnica – empty and filled
  await nav('Uplatnica');
  await check('slip (empty)', app.locator('.actions .primary'));
  await nav('Predlošci');
  await app.locator('.tpl').first().waitFor();
  await check('templates', app.locator('.tpl').last().locator('button:has-text("Uplatnica")'));
  await app.locator('.tpl').first().locator('button:has-text("Uplatnica")').click();
  await app.locator('.code-btn svg').waitFor();
  await check('slip (template)', app.locator('.actions button:has-text("Zabilježi plaćanje")'));
  await app.locator('.code-btn').click();
  await app.locator('.overlay img').waitFor();
  const img = await app.locator('.overlay img').boundingBox();
  assert.ok(img.width <= VIEWPORT.width, 'overlay barcode fits');
  await page.screenshot({ path: `${OUT}/${mode}-barcode-overlay.png` });
  await app.locator('.overlay-close').click();
  step(`${mode}: barcode overlay`);
  await app.locator('.actions button:has-text("Zabilježi plaćanje")').click();
  await modal.waitFor();
  await check('quick entry dialog', modal.locator('button.primary'));
  await modal.locator('button:has-text("Odustani")').click();
  await app.locator('.actions button:has-text("Spremi u predložak")').click();
  await check('save template dialog', modal.locator('button[type=submit]'));
  await modal.locator('button:has-text("Odustani")').click();

  // History, settings, dialogs
  await nav('Predlošci');
  await app.locator('.tpl-main').first().click();
  await app.locator('.hist-table').waitFor();
  await check('history', app.locator('.hist-table tbody').last().locator('tr').last());
  await app.locator('button:has-text("Postavke")').click();
  await check('history settings', app.locator('.chip').last());
  await app.locator('button:has-text("Postavke")').click();
  await app.locator('.hist-table tr', { hasText: '02/26' }).locator('button:has-text("Uredi")').click();
  await check('edit payment dialog', modal.locator('button.primary'));
  await modal.locator('button:has-text("Odustani")').click();
  await app.locator('.hist-table tr', { hasText: '02/26' }).locator('.no-receipt').click();
  await check('receipts dialog', modal.locator('button:has-text("Dodaj potvrdu")'));
  await app.locator('.receipts-head button:has-text("Zatvori")').click();
  await app.locator('button:has-text("Zalijepi stare zapise")').click();
  await app.locator('textarea.paste').fill('09/24 - 30\nRazlika za 9 i 10 - 20eur aircash\n01/22 - 477,89 KN\n11/25 - 40 aircash');
  await check('paste dialog', modal.locator('button.primary'));
  await modal.locator('button:has-text("Prepoznaj zapise")').click();
  await check('paste preview', modal.locator('button.primary'));
  await modal.locator('button:has-text("Odustani")').click();

  // Evidencije
  await nav('Evidencije');
  await check('trackers', app.locator('button:has-text("Nova evidencija")'));
  await app.locator('button:has-text("Nova evidencija")').click();
  await check('new tracker form', app.locator('.new-tracker button[type=submit]'));
  await app.locator('.new-tracker button:has-text("Odustani")').click();
  await app.locator('.tpl-main').first().click();
  await check('tracker history', app.locator('button:has-text("Dodaj zapis")'));

  // Učitaj, Profil
  await nav('Učitaj');
  await check('import', app.locator('.drop button'));
  await nav('Profil');
  await check('profile', app.locator('button:has-text("Uvezi iz kopije")'));

  assert.deepEqual(errors, [], `${mode}: page errors`);
  await ctx.close();
}

(async () => {
  await seed();
  const browser = await chromium.launch();
  for (const mode of ['safari', 'ios-app']) await run(browser, mode);
  console.log('All mobile layout checks passed.');
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});

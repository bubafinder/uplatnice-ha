// End-to-end test through the Ingress mock (app inside an iframe, path prefix, HA user headers).
// Usage: start the server (ALLOW_ANY_CLIENT=1) and test/e2e/ingress-proxy.mjs, then run:
//   PLAYWRIGHT_PATH=... node test/e2e/e2e.cjs
const { chromium } = require(process.env.PLAYWRIGHT_PATH ?? 'playwright');
const fs = require('fs');
const OUT = process.env.OUT_DIR ?? '/tmp/e2e3';
const BASE = 'http://127.0.0.1:8123';
fs.mkdirSync(OUT, { recursive: true });

const NOTES = ['09/24 - 30', '10/24 - 30', '11/24 - 30 aircash', '12/24 - 30 aircash', '04/25 - 30 aircash', '05/25 - 30 aircash',
  '06/25 - 30 aircash', '09/25 - 30 aircash', '10/25 - 30 aircash', 'Razlika za 9 i 10 - 20eur aircash', '11/25 - 40 aircash',
  '12/25 - 40 aircash', '01/26 - 40 aircash', '02/26 - 40 aircash', '03/26 - 40 aircash', '04/26 - 40 aircash', '05/26 - 40 aircash',
  '09/26 - 40 aircash'].join('\n');

const BACKUP = {
  version: 1,
  profile: { name: 'Ivan Horvat', street: 'Ilica 12', city: '10000 Zagreb', iban: '' },
  templates: [{
    id: 'luka1', name: 'Luka - nogomet', useProfile: true, createdAt: '2026-10-30T16:00:00Z', updatedAt: '2026-10-30T16:00:00Z',
    slip: { amountCents: 4000, payer: { name: '', street: '', city: '' },
      payee: { name: 'HNK Val', street: 'Vukovarska 34', city: '21216 Kastel Stari', iban: 'HR1210010051863000160' },
      model: 'HR00', reference: '92781773299', purpose: 'OTHR', description: 'Clanarina za Luka Lovric {mm}/{gg}' },
  }],
};

async function openApp(browser, user, viewport) {
  const ctx = await browser.newContext({ viewport, acceptDownloads: true, hasTouch: viewport.width < 600 });
  await ctx.addCookies([{ name: 'ha_user', value: user, url: BASE }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(`${user}: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`${user}: ${m.text()}`); });
  await page.goto(`${BASE}/hassio/ingress/uplatnice`);
  const app = page.frameLocator('#ingress');
  await app.locator('.top').waitFor();
  return { ctx, page, app, errors };
}

const settle = page => page.waitForTimeout(900); // let the debounced sync finish

(async () => {
  const browser = await chromium.launch();
  const ivan = await openApp(browser, 'Ivan', { width: 1360, height: 900 });
  const { app, page } = ivan;
  await page.screenshot({ path: `${OUT}/01-empty.png` });

  // import the backup from the standalone app
  fs.writeFileSync(`${OUT}/backup.json`, JSON.stringify(BACKUP));
  await app.locator('.top-nav button:has-text("Moj profil")').click();
  await app.locator('input[type=file][accept*=json]').setInputFiles(`${OUT}/backup.json`);
  await app.locator('.toast.is-on').waitFor();
  const importToast = await app.locator('.toast').textContent();

  // paste history from notes
  await app.locator('.top-nav button:has-text("Predlošci")').click();
  await app.locator('.tpl-main').first().click();
  await app.locator('button:has-text("Zalijepi stare zapise")').click();
  await app.locator('textarea.paste').fill(NOTES);
  await app.locator('button:has-text("Prepoznaj zapise")').click();
  await app.locator('.modal button.primary').click();
  await app.locator('button:has-text("Postavke")').click();
  await app.locator('.chip:has-text("srpanj")').click();
  await app.locator('.chip:has-text("kolovoz")').click();
  await app.locator('button:has-text("Postavke")').click();
  await settle(page);

  // quick entry from the slip
  await app.locator('button:has-text("Otvori uplatnicu")').click();
  await app.locator('.code-btn svg').waitFor();
  await page.screenshot({ path: `${OUT}/02-slip.png` });
  const [pdf] = await Promise.all([page.waitForEvent('download'), app.locator('button:has-text("Preuzmi PDF uplatnicu")').click()]);
  await pdf.saveAs(`${OUT}/${pdf.suggestedFilename()}`);
  await app.locator('button:has-text("Zabilježi plaćanje")').click();
  await app.locator('.modal button.primary').click();
  await app.locator('tr.is-new').waitFor();
  await settle(page);
  await page.screenshot({ path: `${OUT}/03-history-ivan.png`, fullPage: true });

  // second family member sees the same data and adds a tracker entry
  const ana = await openApp(browser, 'Ana', { width: 390, height: 844 });
  await ana.app.locator('.bottom-nav button:has-text("Predlošci")').click();
  await ana.page.screenshot({ path: `${OUT}/04-ana-templates-mobile.png` });
  const anaSees = await ana.app.locator('.tpl').count();
  await ana.app.locator('.tpl-main').first().click();
  await ana.app.locator('.hist-table').waitFor();
  await ana.page.screenshot({ path: `${OUT}/05-ana-history-mobile.png`, fullPage: true });
  await ana.app.locator('.bottom-nav button:has-text("Evidencije")').click();
  await ana.app.locator('#tr-name').fill('Struja');
  await ana.app.locator('button:has-text("Dodaj")').click();
  await ana.app.locator('button:has-text("Dodaj zapis")').click();
  await ana.app.locator('#pay-amount').fill('52,10');
  await ana.app.locator('.modal button.primary').click();
  await ana.app.locator('tr.is-new').waitFor();
  await settle(ana.page);
  await ana.page.screenshot({ path: `${OUT}/06-ana-tracker-mobile.png`, fullPage: true });
  // mobile slip
  await ana.app.locator('.bottom-nav button:has-text("Uplatnica")').click();
  await ana.page.screenshot({ path: `${OUT}/07-ana-slip-mobile.png`, fullPage: true });

  // Ivan's tab refreshes on focus and shows Ana's tracker with her name
  await page.reload();
  await app.locator('.top').waitFor();
  await app.locator('.top-nav button:has-text("Evidencije")').click();
  await app.locator('.tpl-main').first().click();
  const who = await app.locator('td.c-who').first().textContent();
  const sync = await app.locator('.sync-text').textContent();
  await page.screenshot({ path: `${OUT}/08-ivan-sees-ana.png` });

  const state = await (await fetch(`${BASE}/api/hassio_ingress/dev-token-123/api/state`)).json();
  console.log(JSON.stringify({
    importToast, anaSees, who, sync,
    templates: state.templates.map(t => [t.name, t.payments.length, t.pauseMonths]),
    trackers: state.trackers.map(t => [t.name, t.payments.map(p => p.recordedBy)]),
    lastQuick: state.templates[0].payments.slice(-1)[0],
    errors: [...ivan.errors, ...ana.errors],
  }, null, 2));
  await browser.close();
})();

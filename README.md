# Uplatnice – Home Assistant add-on

Croatian HUB-3A payment slips with a spec-compliant PDF417 barcode, recurring payment templates, payment history and bill trackers. Runs as a Home Assistant add-on behind Ingress, so it is available to every Home Assistant user on desktop and in the companion app.

## Install

1. In Home Assistant open **Settings → Add-ons → Add-on Store → ⋮ → Repositories** and add `https://github.com/bubafinder/uplatnice-ha`.
2. Install **Uplatnice**, start it and enable **Show in sidebar**.

Images are published to GitHub Container Registry for `aarch64` (Raspberry Pi 4/5) and `amd64`.

## Features

- HUB-3A slip editor with live validation (IBAN, payment reference models and check digits, character set, field lengths) and a PDF417 barcode (9 columns, ECC level 4) for scanning from the screen.
- A4 PDF with the HUB-3A form, barcode PNG download/share.
- Templates with month placeholders (`{mjesec}`, `{Mjesec}`, `{mm}`, `{gg}`, `{godina}`).
- Payment history per template and trackers for bills without a slip: yearly totals, missing months, pause months, HRK amounts kept as-is.
- Paste import from notes (`11/25 - 40 aircash`), barcode import from PDF/images, backup import from the standalone HTML version.
- Every payment stores the Home Assistant user who recorded it.

## Development

Requires Node.js ≥ 22.13 (uses the built-in `node:sqlite`).

```sh
npm install
npm test
npm run build
npm start                 # server on :8099 with ALLOW_ANY_CLIENT=1, data in ./data
npm run ingress-mock      # http://127.0.0.1:8123/hassio/ingress/uplatnice – mimics HA Ingress
```

End-to-end test (needs Playwright): `node test/e2e/e2e.cjs` with the server and the ingress mock running.

## Architecture

| Part | Tech |
|---|---|
| `src/web` | React, bwip-js (vendored, PDF417), jsPDF, pdf.js + ZXing for barcode import; bundled with esbuild into a single HTML file |
| `src/server` | Node.js `node:http` + `node:sqlite`, bundled into one file, no runtime dependencies |
| `src/shared` | HUB-3 formatting/validation, payment history logic, state diff used for sync |
| `uplatnice/` | Home Assistant add-on (Ingress, port 8099, data in `/data/uplatnice.db`) |

Third-party: bwip-js (MIT, `src/web/vendor`), DejaVu fonts (subset, `assets/fonts`).

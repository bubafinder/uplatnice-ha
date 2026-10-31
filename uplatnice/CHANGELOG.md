# Changelog

## 0.2.1

- Phones: the navigation is now a tab bar at the top of the screen. It was hidden behind Safari's floating toolbar and could end up at the bottom of the page in the Home Assistant iOS app.
- Phones: the page is one screen tall and only the content scrolls, so the navigation stays visible; dialogs scroll so their buttons can be moved above the browser toolbar.
- Phones: template and tracker lists, the pasted-notes preview and the search field are laid out for narrow screens.

## 0.2.0

- Payment confirmations (receipts): attach PDFs or images to any payment record, either in the quick entry dialog or later from the history (📎). Drag & drop and paste (Ctrl+V) are supported.
- Receipts are previewed in the app (PDF pages and images), can be downloaded or deleted, and records without a receipt are marked.
- Large photos are shrunk before upload; PDFs and screenshots are stored unchanged. Maximum file size is 15 MB.
- Receipts are stored in `/data/receipts` and included in Home Assistant backups; *Moj profil* offers a ZIP download of all receipts.
- Deleting a payment, template or tracker also deletes its receipts.

## 0.1.0

- First Home Assistant add-on release: HUB-3A slips with PDF417 barcode and PDF, templates, payment history, trackers, notes import, backup import from the standalone HTML app.
- Data stored in SQLite on Home Assistant, shared by all users; each payment records the Home Assistant user who entered it.
- Mobile layout with bottom navigation.

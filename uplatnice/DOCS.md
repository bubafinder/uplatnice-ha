# Uplatnice

Create Croatian HUB-3A payment slips (uplatnice) with a PDF417 barcode that mobile banking apps can scan, keep templates for recurring payments, and track payment history and bills.

## Usage

Once the add-on is running, **Uplatnice** appears in the Home Assistant sidebar. Everyone with access to this Home Assistant can use it, on desktop and in the Home Assistant companion app. If you reach Home Assistant from outside your home (for example over VPN), the app works there too.

- **Uplatnica** – fill in the slip, scan the barcode from the screen or download the PDF. *Zabilježi plaćanje* records the payment in the history.
- **Predlošci** – templates for recurring payments. `{mjesec}`, `{mm}`, `{gg}` and `{godina}` in the description are replaced with the selected month.
- **Evidencije** – payment history for bills without a slip (water, electricity, …).
- **Učitaj** – read the barcode from an existing slip (PDF or image) and save it as a template.
- **Moj profil** – shared payer details, backup download and import.

Each payment record stores the name of the Home Assistant user who entered it.

## Moving from the standalone HTML version

In the old `uplatnice.html` file download a backup (*Moj profil → Preuzmi sigurnosnu kopiju*), then import it in the add-on (*Moj profil → Uvezi iz kopije*). Importing adds data and never deletes existing entries.

## Data and backups

All data is stored in `/data/uplatnice.db` inside the add-on and is included in Home Assistant backups. The add-on only accepts requests through Home Assistant Ingress, so Home Assistant handles login and permissions.

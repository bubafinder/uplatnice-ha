# Uplatnice

Izrada hrvatskih uplatnica (HUB-3A) s PDF417 barkodom koji se skenira mobilnim bankarstvom, predlošci za redovita plaćanja, povijest plaćanja i evidencije računa.

## Korištenje

Nakon pokretanja add-ona u bočnom izborniku Home Assistanta pojavi se **Uplatnice**. Aplikacija je dostupna svima koji imaju pristup ovom Home Assistantu, na računalu i u Home Assistant aplikaciji na mobitelu. Ako Home Assistantu pristupaš izvan kuće (npr. VPN), radi i tamo.

- **Uplatnica** – ispuni podatke, skeniraj barkod s ekrana ili preuzmi PDF. „Zabilježi plaćanje” sprema zapis u povijest.
- **Predlošci** – uplatnice koje plaćaš redovito. U opisu `{mjesec}`, `{mm}`, `{gg}` i `{godina}` mijenjaju se automatski.
- **Evidencije** – povijest plaćanja za račune bez uplatnice (voda, struja…).
- **Učitaj** – pročitaj barkod s tuđe uplatnice (PDF ili slika) i spremi ga kao predložak.
- **Moj profil** – zajednički podaci platitelja, sigurnosna kopija i uvoz.

Uz svaki zapis o plaćanju sprema se ime Home Assistant korisnika koji ga je unio.

## Prijenos iz HTML verzije

U staroj `uplatnice.html` datoteci preuzmi sigurnosnu kopiju (Moj profil → Preuzmi sigurnosnu kopiju), zatim je u add-onu uvezi (Moj profil → Uvezi iz kopije). Uvoz dodaje podatke i ne briše postojeće.

## Podaci i sigurnosna kopija

Svi podaci su u datoteci `/data/uplatnice.db` unutar add-ona i ulaze u sigurnosnu kopiju Home Assistanta. Add-on prima zahtjeve samo kroz Home Assistant (Ingress), pa prijavu i dozvole rješava Home Assistant.

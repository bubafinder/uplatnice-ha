import { useRef, useState } from 'react';
import { ibanError, formatIban } from '../../shared/iban';
import { invalidChars, MAX, charLength } from '../../shared/text';
import type { Issue, Profile } from '../../shared/types';
import { api } from '../lib/api';
import { exportBackup, type Store } from '../lib/storage';
import { plural } from '../../shared/history';
import { downloadBlob } from './download';
import { Field } from './fields';

interface Props {
  store: Store;
  replace: (s: Store) => void;
  update: (fn: (s: Store) => Store) => void;
  toast: (m: string) => void;
}

function textIssue(field: 'payer.name' | 'payer.street' | 'payer.city', v: string): Issue | undefined {
  const bad = invalidChars(v);
  if (bad.length) return { field, level: 'error', message: `Nedozvoljeni znakovi: ${bad.join(' ')}` };
  if (charLength(v) > MAX[field]) return { field, level: 'error', message: `Najviše ${MAX[field]} znakova.` };
}

export function ProfileView({ store, replace, update, toast }: Props) {
  const p = store.profile;
  const set = (patch: Partial<Profile>) => update(s => ({ ...s, profile: { ...s.profile, ...patch } }));
  const file = useRef<HTMLInputElement>(null);
  const [ibanTouched, setIbanTouched] = useState(false);
  const ibanErr = p.iban && ibanTouched ? ibanError(p.iban) : null;

  const doImport = async (f: File) => {
    try {
      let data: unknown;
      try { data = JSON.parse(await f.text()); } catch { throw new Error('Datoteka nije ispravna sigurnosna kopija.'); }
      const { counts, state } = await api.importBackup(data);
      replace(state);
      toast(`Uvezeno: ${plural(counts.templates, 'predložak', 'predloška', 'predložaka')}, ${plural(counts.trackers, 'evidencija', 'evidencije', 'evidencija')}, ${plural(counts.payments, 'zapis', 'zapisa', 'zapisa')}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Datoteku nije moguće učitati.');
    }
  };

  return (
    <section className="page narrow">
      <header className="page-head"><h1>Moj profil</h1></header>
      <p className="lead">Ovi podaci se upisuju kao platitelj na svaku uplatnicu na kojoj je uključen „Moj profil". Profil je zajednički za sve korisnike.{store.me ? ` Prijavljen si kao ${store.me.name}.` : ''}</p>
      <div className="card form-card">
        <Field label="Ime i prezime" value={p.name} max={MAX['payer.name']} issue={textIssue('payer.name', p.name)} onChange={v => set({ name: v })} />
        <Field label="Ulica i broj" value={p.street} max={MAX['payer.street']} issue={textIssue('payer.street', p.street)} onChange={v => set({ street: v })} />
        <Field label="Poštanski broj i mjesto" value={p.city} max={MAX['payer.city']} issue={textIssue('payer.city', p.city)} onChange={v => set({ city: v })} placeholder="npr. 21000 Split" />
        <Field label="Moj IBAN (nije obavezno)" mono value={p.iban} onChange={v => set({ iban: v.toUpperCase() })}
          onBlur={() => { setIbanTouched(true); set({ iban: p.iban ? formatIban(p.iban) : '' }); }}
          issue={ibanErr ? { field: 'payee.iban', level: 'error', message: ibanErr } : undefined}
          hint="Upisuje se samo na PDF uplatnicu, u polje računa platitelja. Nije dio barkoda." />
      </div>

      <h2 className="section">Sigurnosna kopija i uvoz</h2>
      <p className="lead">Svi podaci spremljeni su na Home Assistantu i ulaze u njegovu sigurnosnu kopiju. Ovdje možeš dodatno preuzeti kopiju u datoteku. „Uvezi iz kopije" dodaje predloške, evidencije i zapise iz datoteke (i iz ranije HTML verzije aplikacije); postojeći podaci se ne brišu.</p>
      <p className="backup-when">{store.lastBackupAt ? `Zadnja kopija: ${new Date(store.lastBackupAt).toLocaleDateString('hr-HR')}` : 'Kopija još nije napravljena.'}</p>
      <div className="row-actions">
        <button className="primary" onClick={() => {
          downloadBlob(exportBackup(store), `uplatnice-kopija-${new Date().toISOString().slice(0, 10)}.json`);
          update(s => ({ ...s, lastBackupAt: new Date().toISOString() }));
        }}>Preuzmi sigurnosnu kopiju</button>
        <button onClick={() => file.current?.click()}>Uvezi iz kopije…</button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = ''; }} />
      </div>
    </section>
  );
}

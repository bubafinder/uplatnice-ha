import { useState } from 'react';
import { formatAmount } from '../../shared/hub3';
import { currencyLabel, lastPayment, plural, shortYm, statusFor } from '../../shared/history';
import type { Tracker } from '../../shared/types';
import { newId, type Store } from '../lib/storage';
import { StatusBadge } from './StatusBadge';

interface Props {
  store: Store;
  update: (fn: (s: Store) => Store) => void;
  open: (t: Tracker) => void;
  toast: (m: string) => void;
}

export function Trackers({ store, update, open, toast }: Props) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);

  const create = () => {
    const n = name.trim();
    if (!n) return;
    const now = new Date().toISOString();
    const t: Tracker = { id: newId(), name: n, createdAt: now, updatedAt: now, payments: [], pauseMonths: [] };
    update(s => ({ ...s, trackers: [...s.trackers, t] }));
    setName('');
    setAdding(false);
    toast(`Evidencija „${n}" je dodana.`);
    open(t);
  };

  const list = [...store.trackers].sort((a, b) => a.name.localeCompare(b.name, 'hr'));

  return (
    <section className="page">
      <header className="page-head">
        <h1>Evidencije</h1>
        {!adding && list.length > 0 && <button className="primary" onClick={() => setAdding(true)}>Nova evidencija</button>}
      </header>
      <p className="lead">Popis plaćanja za račune bez uplatnice u aplikaciji, npr. voda, struja ili telefon.</p>

      {(adding || !list.length) && (
        <form className="card new-tracker" onSubmit={e => { e.preventDefault(); create(); }}>
          <div className="fld plain grow">
            <label htmlFor="tr-name">Naziv nove evidencije</label>
            <input id="tr-name" value={name} onChange={e => setName(e.target.value)} placeholder="npr. Voda" autoFocus={adding} />
          </div>
          <button type="submit" className="primary" disabled={!name.trim()}>Dodaj</button>
          {adding && <button type="button" className="link" onClick={() => setAdding(false)}>Odustani</button>}
        </form>
      )}

      {list.length > 0 && (
        <ul className="tpl-list">
          {list.map(t => {
            const last = lastPayment(t.payments);
            return (
              <li key={t.id} className="tpl tracker">
                <button className="tpl-main" onClick={() => open(t)}>
                  <span className="tpl-name">{t.name}</span>
                  <span className="tpl-desc">
                    {last ? `Zadnje: ${last.period ? shortYm(last.period) : 'posebna'} – ${formatAmount(last.amountCents)} ${currencyLabel(last.currency)}` : 'Još nema zapisa'}
                    {t.payments.length > 0 && ` · ${plural(t.payments.length, 'zapis', 'zapisa', 'zapisa')}`}
                  </span>
                </button>
                <StatusBadge status={statusFor(t.payments, t.pauseMonths)} />
                <div className="tpl-actions">
                  <button className="small" onClick={() => open(t)}>Povijest</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

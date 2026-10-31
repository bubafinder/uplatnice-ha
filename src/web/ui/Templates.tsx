import { useState } from 'react';
import { formatAmount } from '../../shared/hub3';
import { statusFor } from '../../shared/history';
import { currentPeriod, fillPlaceholders, hasPlaceholders } from '../../shared/placeholders';
import type { Template } from '../../shared/types';
import type { Store } from '../lib/storage';
import { StatusBadge } from './StatusBadge';

interface Props {
  store: Store;
  openSlip: (t: Template) => void;
  openHistory: (t: Template) => void;
  goNew: () => void;
  goScan: () => void;
}

export function Templates({ store, openSlip, openHistory, goNew, goScan }: Props) {
  const [q, setQ] = useState('');
  const period = currentPeriod();
  const list = [...store.templates]
    .sort((a, b) => (b.lastUsedAt ?? b.updatedAt).localeCompare(a.lastUsedAt ?? a.updatedAt))
    .filter(t => !q || (t.name + ' ' + t.slip.payee.name + ' ' + t.slip.description).toLowerCase().includes(q.toLowerCase()));

  if (!store.templates.length) {
    return (
      <section className="page empty-state">
        <h1>Predlošci</h1>
        <p>Ovdje će biti uplatnice koje plaćaš redovito, npr. nogomet ili vrtić. Otvoriš predložak, provjeriš iznos i mjesec, i barkod je spreman. Uz svaki predložak vodi se i povijest plaćanja.</p>
        <div className="row-actions">
          <button className="primary" onClick={goNew}>Napravi prvu uplatnicu</button>
          <button onClick={goScan}>Učitaj s postojeće uplatnice</button>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <header className="page-head">
        <h1>Predlošci</h1>
        {store.templates.length > 5 && (
          <input className="search" type="search" placeholder="Traži predložak" value={q} onChange={e => setQ(e.target.value)} aria-label="Traži predložak" />
        )}
      </header>
      <ul className="tpl-list">
        {list.map(t => {
          const auto = hasPlaceholders(t.slip.description) || hasPlaceholders(t.slip.reference);
          return (
            <li key={t.id} className="tpl">
              <button className="tpl-main" onClick={() => openHistory(t)}>
                <span className="tpl-name">{t.name}</span>
                <span className="tpl-payee">{t.slip.payee.name}{t.slip.amountCents ? ` · ${formatAmount(t.slip.amountCents)} EUR` : ''}</span>
                <span className="tpl-desc">{fillPlaceholders(t.slip.description, period) || 'Bez opisa'}{auto && <em className="tag">mjesec se mijenja sam</em>}</span>
              </button>
              <StatusBadge status={statusFor(t.payments, t.pauseMonths)} />
              <div className="tpl-actions">
                <button className="primary small" onClick={() => openSlip(t)}>Uplatnica</button>
                <button className="small" onClick={() => openHistory(t)}>Povijest{t.payments.length ? ` (${t.payments.length})` : ''}</button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

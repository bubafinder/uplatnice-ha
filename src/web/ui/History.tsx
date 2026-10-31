import { useEffect, useMemo, useRef, useState } from 'react';
import { formatAmount } from '../../shared/hub3';
import { currencyLabel, currentYm, fmtDate, groupByYear, longYm, plural, shortYm, statusFor, todayIso } from '../../shared/history';
import { MONTHS } from '../../shared/placeholders';
import type { Currency, OwnerRef, Payment } from '../../shared/types';
import { addPayments, getOwner, rememberMethod, updateOwner, type Store } from '../lib/storage';
import { PasteImport } from './PasteImport';
import { PaymentDialog } from './PaymentDialog';
import { StatusBadge } from './StatusBadge';

interface Props {
  ownerRef: OwnerRef;
  store: Store;
  update: (fn: (s: Store) => Store) => void;
  highlight?: string;
  back: () => void;
  openSlip?: () => void;
  toast: (m: string) => void;
}

const money = (t: Partial<Record<Currency, number>>) =>
  (Object.entries(t) as [Currency, number][]).map(([c, v]) => `${formatAmount(v)} ${currencyLabel(c)}`).join(' + ') || '0,00 EUR';

export function History({ ownerRef, store, update, highlight, back, openSlip, toast }: Props) {
  const owner = getOwner(store, ownerRef);
  const [dialog, setDialog] = useState<null | { initial: Partial<Payment>; editing: boolean }>(null);
  const [pasting, setPasting] = useState(false);
  const [settings, setSettings] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [flash, setFlash] = useState<string | undefined>(highlight);
  const now = currentYm();
  const groups = useMemo(() => (owner ? groupByYear(owner.payments, owner.pauseMonths, now) : []), [owner, now]);
  const hlRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => { setFlash(highlight); }, [highlight]);
  useEffect(() => {
    if (flash) {
      hlRef.current?.scrollIntoView({ block: 'center' });
      const t = setTimeout(() => setFlash(undefined), 4000);
      return () => clearTimeout(t);
    }
  }, [flash]);

  if (!owner) return <section className="page"><p>Stavka više ne postoji.</p><button onClick={back}>Natrag</button></section>;

  const isTpl = owner.kind === 'template';
  const status = statusFor(owner.payments, owner.pauseMonths, now);
  const missingCount = groups.reduce((a, g) => a + g.rows.reduce((n, r) => n + (r.kind === 'missing' ? 1 : r.kind === 'gap' ? r.count : 0), 0), 0);

  const savePayment = (p: Payment, editing: boolean) => {
    update(s => {
      let next = editing
        ? updateOwner(s, ownerRef, o => ({ payments: o.payments.map(x => (x.id === p.id ? p : x)) }))
        : addPayments(s, ownerRef, [p]);
      return rememberMethod(next, p.method);
    });
    setDialog(null);
    setFlash(p.id);
    toast(editing ? 'Zapis je izmijenjen.' : `Zabilježeno: ${p.period ? shortYm(p.period) : 'posebna uplata'}, ${formatAmount(p.amountCents)} ${currencyLabel(p.currency)}.`);
  };

  const deletePayment = (id: string) => {
    update(s => updateOwner(s, ownerRef, o => ({ payments: o.payments.filter(x => x.id !== id) })));
    setDialog(null);
    toast('Zapis je obrisan.');
  };

  const addFor = (period?: string) => {
    const last = [...owner.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    setDialog({
      editing: false,
      initial: {
        period: period ?? (status.kind === 'paid' ? undefined : now),
        amountCents: last?.amountCents ?? (isTpl ? owner.slip.amountCents : null),
        currency: 'EUR',
        paidOn: todayIso(),
        method: [...owner.payments].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find(x => x.method)?.method ?? store.lastMethod,
      },
    });
  };

  const togglePause = (m: number) =>
    update(s => updateOwner(s, ownerRef, o => ({ pauseMonths: o.pauseMonths.includes(m) ? o.pauseMonths.filter(x => x !== m) : [...o.pauseMonths, m].sort((a, b) => a - b) })));

  const rename = (name: string) => update(s => updateOwner(s, ownerRef, () => ({ name })));

  const deleteOwner = () => {
    update(s => (ownerRef.kind === 'template'
      ? { ...s, templates: s.templates.filter(t => t.id !== ownerRef.id) }
      : { ...s, trackers: s.trackers.filter(t => t.id !== ownerRef.id) }));
    toast(`„${owner.name}" je obrisan${isTpl ? '' : 'a'}.`);
    back();
  };

  return (
    <section className="page history">
      <button className="link back" onClick={back}>‹ {isTpl ? 'Predlošci' : 'Evidencije'}</button>
      <header className="hist-head">
        <div>
          <h1>{owner.name}</h1>
          <p className="sub">
            {isTpl ? [owner.slip.payee.name, owner.slip.amountCents ? `${formatAmount(owner.slip.amountCents)} EUR` : null].filter(Boolean).join(' · ') : 'Evidencija plaćanja'}
          </p>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="hist-actions">
        {openSlip && <button className="primary" onClick={openSlip}>Otvori uplatnicu</button>}
        <button className={openSlip ? '' : 'primary'} onClick={() => addFor()}>Dodaj zapis</button>
        <button onClick={() => setPasting(true)}>Zalijepi stare zapise</button>
        <button className="link" onClick={() => setSettings(s => !s)} aria-expanded={settings}>Postavke</button>
      </div>

      {settings && (
        <div className="card settings">
          <div className="fld plain">
            <label htmlFor="own-name">Naziv</label>
            <input id="own-name" value={owner.name} onChange={e => rename(e.target.value)} />
          </div>
          <div>
            <p className="set-label">Mjeseci kad se ne plaća</p>
            <p className="set-help">Ti se mjeseci ne prikazuju kao neplaćeni, npr. srpanj i kolovoz za ljetnu stanku.</p>
            <div className="chips">
              {MONTHS.map((m, i) => (
                <button key={m} className={'chip' + (owner.pauseMonths.includes(i + 1) ? ' is-on' : '')} aria-pressed={owner.pauseMonths.includes(i + 1)} onClick={() => togglePause(i + 1)}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="danger-zone">
            {confirmDelete ? (
              <>
                <span>Obrisati „{owner.name}" i svih {owner.payments.length} zapisa?</span>
                <button className="danger small" onClick={deleteOwner}>Obriši</button>
                <button className="link small" onClick={() => setConfirmDelete(false)}>Odustani</button>
              </>
            ) : (
              <button className="link danger-link" onClick={() => setConfirmDelete(true)}>Obriši {isTpl ? 'predložak' : 'evidenciju'}…</button>
            )}
          </div>
        </div>
      )}

      {!owner.payments.length ? (
        <div className="hist-empty">
          <p>Još nema zapisa. Kad platiš, dodaj zapis. Stare uplate iz bilješki možeš zalijepiti odjednom.</p>
        </div>
      ) : (
        <>
          {missingCount > 0 && <p className="hist-note">Bez zapisa: {plural(missingCount, 'mjesec', 'mjeseca', 'mjeseci')}. Mjesece u kojima se ne plaća označi u Postavkama kao pauzu.</p>}
          <div className="table-wrap">
            <table className="hist-table">
              <thead>
                <tr><th>Mjesec</th><th className="num">Iznos</th><th>Datum plaćanja</th><th>Način</th><th>Napomena</th><th>Zabilježio</th><th aria-label="Radnje" /></tr>
              </thead>
              {groups.map(g => (
                <tbody key={g.year}>
                  <tr className="year-row">
                    <th colSpan={7} scope="rowgroup">
                      <span className="yr">{g.year}.</span>
                      {g.count > 0 ? (
                        <>
                          <span className="yr-sum">{money(g.totals)}</span>
                          <span className="yr-count">{plural(g.count, 'uplata', 'uplate', 'uplata')}</span>
                        </>
                      ) : <span className="yr-count">nema uplata</span>}
                    </th>
                  </tr>
                  {g.rows.map(r => r.kind === 'gap' ? (
                    <tr key={'g' + r.from} className="missing">
                      <td>{shortYm(r.from)} – {shortYm(r.to)}</td>
                      <td colSpan={5} className="gap-text">{plural(r.count, 'mjesec', 'mjeseca', 'mjeseci')} bez zapisa</td>
                      <td className="row-act" />
                    </tr>
                  ) : r.kind === 'missing' ? (
                    <tr key={'m' + r.ym} className="missing">
                      <td>{shortYm(r.ym)}</td>
                      <td colSpan={5} className="gap-text">{r.ym === now ? 'Ovaj mjesec još nije zabilježen' : 'Nema zapisa'}</td>
                      <td className="row-act"><button className="link small" onClick={() => addFor(r.ym)}>Dodaj</button></td>
                    </tr>
                  ) : (
                    <tr key={r.p.id} ref={flash === r.p.id ? hlRef : undefined} className={flash === r.p.id ? 'is-new' : ''}>
                      <td className="c-month" title={r.p.period ? longYm(r.p.period) : undefined}>{r.p.period ? shortYm(r.p.period) : <span className="special">posebna</span>}</td>
                      <td className="num">{formatAmount(r.p.amountCents)} <span className="cur">{currencyLabel(r.p.currency)}</span></td>
                      <td className="c-date" data-label="Plaćeno">{fmtDate(r.p.paidOn) || <span className="dim">–</span>}</td>
                      <td className="c-method" data-label="Način">{r.p.method ?? <span className="dim">–</span>}</td>
                      <td className="note" data-label="Napomena">{r.p.note}</td>
                      <td className="c-who" data-label="Zabilježio">{r.p.recordedBy ?? <span className="dim">–</span>}</td>
                      <td className="row-act"><button className="link small" onClick={() => setDialog({ initial: r.p, editing: true })}>Uredi</button></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}

      {dialog && (
        <PaymentDialog
          title={dialog.editing ? 'Uredi zapis' : `Zabilježi plaćanje · ${owner.name}`}
          initial={dialog.initial}
          methods={store.methods}
          existing={owner.payments}
          onCancel={() => setDialog(null)}
          onSave={p => savePayment(p, dialog.editing)}
          onDelete={dialog.editing ? () => deletePayment(dialog.initial.id!) : undefined}
        />
      )}
      {pasting && (
        <PasteImport
          name={owner.name}
          methods={store.methods}
          existing={owner.payments}
          onCancel={() => setPasting(false)}
          onImport={items => {
            update(s => {
              const next = addPayments(s, ownerRef, items);
              const counts = new Map<string, number>();
              for (const it of items) if (it.method) counts.set(it.method, (counts.get(it.method) ?? 0) + 1);
              const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
              return top && !s.lastMethod ? rememberMethod(next, top) : next;
            });
            setPasting(false);
            toast(`Spremljeno: ${plural(items.length, 'zapis', 'zapisa', 'zapisa')}.`);
          }}
        />
      )}
    </section>
  );
}


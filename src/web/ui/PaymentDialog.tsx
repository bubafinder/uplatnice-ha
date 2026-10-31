import { useState } from 'react';
import { formatAmount, parseAmount } from '../../shared/hub3';
import { currencyLabel, parsePeriodInput, parseYm, shortYm, todayIso, ym } from '../../shared/history';
import type { Currency, Payment } from '../../shared/types';
import { newId } from '../lib/storage';
import { ReceiptPicker } from './receipts';

export interface Destination {
  value: string; // 'template:<id>' | 'tracker:<id>' | 'new-template'
  label: string;
}

interface Props {
  title: string;
  initial: Partial<Payment>;
  methods: string[];
  existing: Payment[]; // used to warn about duplicate entries
  destinations?: { options: Destination[]; initial: string; newName: string };
  onSave: (p: Payment, dest: { value: string; newName: string } | undefined, files: File[]) => void;
  onCancel: () => void;
  onDelete?: () => void;
  saveLabel?: string;
}

const OTHER = '__drugo__';

export function PaymentDialog(p: Props) {
  const init = p.initial;
  const [noPeriod, setNoPeriod] = useState(!init.period && !!init.id);
  const [periodText, setPeriodText] = useState(init.period ? shortYm(init.period) : '');
  const [amountText, setAmountText] = useState(formatAmount(init.amountCents ?? null));
  const [currency, setCurrency] = useState<Currency>(init.currency ?? 'EUR');
  const [paidOn, setPaidOn] = useState(init.paidOn ?? '');
  const knownMethod = !init.method || p.methods.includes(init.method);
  const [methodSel, setMethodSel] = useState(init.method ? (knownMethod ? init.method : OTHER) : '');
  const [methodOther, setMethodOther] = useState(knownMethod ? '' : init.method ?? '');
  const [note, setNote] = useState(init.note ?? '');
  const [dest, setDest] = useState(p.destinations?.initial ?? '');
  const [newName, setNewName] = useState(p.destinations?.newName ?? '');
  const [tried, setTried] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const receiptCount = init.receipts?.length ?? 0;

  const period = noPeriod ? null : parsePeriodInput(periodText);
  const periodErr = !noPeriod && !period ? (periodText ? 'Upiši mjesec kao MM/GG, npr. 11/26.' : 'Upiši za koji mjesec, ili označi posebnu uplatu.') : null;
  const amount = amountText.trim() ? parseAmount(amountText) : null;
  const amountErr = amountText.trim() && amount === null ? 'Iznos nije ispravan.' : !amountText.trim() ? 'Upiši iznos.' : null;
  const destErr = p.destinations && dest === 'new-template' && !newName.trim() ? 'Upiši naziv predloška.' : p.destinations && !dest ? 'Odaberi gdje spremiti.' : null;
  const dup = period ? p.existing.filter(x => x.period === period && x.id !== init.id) : [];

  const shift = (by: number) => {
    const base = parsePeriodInput(periodText) ?? ym(new Date().getFullYear(), new Date().getMonth() + 1);
    const { year, month } = parseYm(base);
    const i = year * 12 + month - 1 + by;
    setPeriodText(shortYm(ym(Math.floor(i / 12), (i % 12) + 1)));
    setNoPeriod(false);
  };

  const submit = () => {
    setTried(true);
    if (periodErr || amountErr || destErr) return;
    const method = methodSel === OTHER ? methodOther.trim() || undefined : methodSel || undefined;
    const pay: Payment = {
      id: init.id ?? newId(),
      period: period ?? undefined,
      at: period ?? init.at ?? (paidOn ? paidOn.slice(0, 7) : todayIso().slice(0, 7)),
      amountCents: amount,
      currency,
      paidOn: paidOn || undefined,
      method,
      note: note.trim() || undefined,
      createdAt: init.createdAt ?? new Date().toISOString(),
    };
    p.onSave({ ...pay, ...(init.receipts ? { receipts: init.receipts } : {}) }, p.destinations ? { value: dest, newName: newName.trim() } : undefined, files);
  };

  return (
    <div className="modal-back" onClick={p.onCancel}>
      <form className="modal pay-modal" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); submit(); }}>
        <h2>{p.title}</h2>

        {p.destinations && (
          <div className="fld plain">
            <label htmlFor="pay-dest">Spremi u</label>
            <select id="pay-dest" value={dest} onChange={e => setDest(e.target.value)}>
              <option value="" disabled>Odaberi…</option>
              <option value="new-template">Novi predložak iz ove uplatnice</option>
              {p.destinations.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {tried && destErr && dest !== 'new-template' && <p className="msg">{destErr}</p>}
          </div>
        )}
        {p.destinations && dest === 'new-template' && (
          <div className={'fld plain' + (tried && destErr ? ' is-err' : '')}>
            <label htmlFor="pay-newname">Naziv novog predloška</label>
            <input id="pay-newname" value={newName} onChange={e => setNewName(e.target.value)} placeholder="npr. Nogomet – Luka" />
            {tried && destErr && <p className="msg">{destErr}</p>}
          </div>
        )}

        <div className="pay-row">
          <div className={'fld plain period-fld' + (tried && periodErr ? ' is-err' : '') + (noPeriod ? ' is-disabled' : '')}>
            <label htmlFor="pay-period">Za mjesec</label>
            <div className="period-input">
              <button type="button" className="icon" onClick={() => shift(-1)} aria-label="Prethodni mjesec" disabled={noPeriod}>‹</button>
              <input id="pay-period" value={noPeriod ? '' : periodText} disabled={noPeriod} placeholder="MM/GG" inputMode="numeric"
                onChange={e => setPeriodText(e.target.value)} autoFocus={!p.destinations} />
              <button type="button" className="icon" onClick={() => shift(1)} aria-label="Sljedeći mjesec" disabled={noPeriod}>›</button>
            </div>
            {tried && periodErr && <p className="msg">{periodErr}</p>}
          </div>
          <div className={'fld plain amount-fld' + (tried && amountErr ? ' is-err' : '')}>
            <label htmlFor="pay-amount">Iznos</label>
            <div className="amount-input">
              <input id="pay-amount" value={amountText} onChange={e => setAmountText(e.target.value)} inputMode="decimal" placeholder="0,00"
                onBlur={() => amount !== null && setAmountText(formatAmount(amount))} />
              <select aria-label="Valuta" value={currency} onChange={e => setCurrency(e.target.value as Currency)}>
                <option value="EUR">EUR</option>
                <option value="HRK">kn</option>
              </select>
            </div>
            {tried && amountErr && <p className="msg">{amountErr}</p>}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={noPeriod} onChange={e => setNoPeriod(e.target.checked)} />
          <span>Posebna uplata, nije za određeni mjesec (npr. razlika, oprema)</span>
        </label>
        {dup.length > 0 && (
          <p className="note-warn">Za {shortYm(period!)} već postoji zapis ({dup.map(d => `${formatAmount(d.amountCents)} ${currencyLabel(d.currency)}`).join(', ')}). Svejedno možeš spremiti.</p>
        )}

        <div className="pay-row">
          <div className="fld plain">
            <label htmlFor="pay-date">Datum plaćanja</label>
            <input id="pay-date" type="date" value={paidOn} onChange={e => setPaidOn(e.target.value)} />
          </div>
          <div className="fld plain">
            <label htmlFor="pay-method">Način plaćanja</label>
            <select id="pay-method" value={methodSel} onChange={e => setMethodSel(e.target.value)}>
              <option value="">Nije navedeno</option>
              {p.methods.map(m => <option key={m} value={m}>{m}</option>)}
              <option value={OTHER}>Drugo…</option>
            </select>
          </div>
        </div>
        {methodSel === OTHER && (
          <div className="fld plain">
            <label htmlFor="pay-method-other">Novi način plaćanja</label>
            <input id="pay-method-other" value={methodOther} onChange={e => setMethodOther(e.target.value)} placeholder="npr. Revolut" autoFocus />
          </div>
        )}
        <div className="fld plain">
          <label htmlFor="pay-note">Napomena</label>
          <input id="pay-note" value={note} onChange={e => setNote(e.target.value)} placeholder="Nije obavezno" />
        </div>

        <ReceiptPicker files={files} setFiles={setFiles} />
        {receiptCount > 0 && <p className="picker-hint">Već spremljeno potvrda: {receiptCount}. Pregled i brisanje su u povijesti, preko ikone 📎.</p>}

        <div className="modal-actions">
          {p.onDelete ? (
            confirmDelete ? (
              <span className="confirm-inline">
                <button type="button" className="danger small" onClick={p.onDelete}>{receiptCount ? `Obriši zapis i potvrde (${receiptCount})` : 'Obriši zapis'}</button>
                <button type="button" className="link small" onClick={() => setConfirmDelete(false)}>Ne</button>
              </span>
            ) : (
              <button type="button" className="link danger-link" onClick={() => setConfirmDelete(true)}>Obriši zapis…</button>
            )
          ) : <span />}
          <button type="button" className="link" onClick={p.onCancel}>Odustani</button>
          <button type="submit" className="primary">{p.saveLabel ?? 'Spremi'}</button>
        </div>
      </form>
    </div>
  );
}

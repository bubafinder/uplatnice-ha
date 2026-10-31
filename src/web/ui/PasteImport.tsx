import { useMemo, useState } from 'react';
import { formatAmount, parseAmount } from '../../shared/hub3';
import { currencyLabel, parsePeriodInput, plural, shortYm, todayIso } from '../../shared/history';
import { parseNotes, type ParsedLine } from '../../shared/notesImport';
import type { Payment } from '../../shared/types';
import { newId } from '../lib/storage';

interface Props {
  name: string;
  methods: string[];
  existing: Payment[];
  onImport: (items: Payment[]) => void;
  onCancel: () => void;
}

interface Row extends ParsedLine {
  include: boolean;
  dup: boolean;
  periodText: string;
  amountText: string;
}

const EXAMPLE = `09/24 - 30
11/24 - 30 aircash
Razlika za 9 i 10 - 20eur aircash
01/22 - 477,89 KN`;

export function PasteImport({ name, methods, existing, onImport, onCancel }: Props) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<Row[] | null>(null);
  const existingPeriods = useMemo(() => new Set(existing.map(e => e.period).filter(Boolean)), [existing]);

  const analyze = () => {
    setRows(parseNotes(text, methods).map(l => {
      const dup = !!l.period && existingPeriods.has(l.period);
      return { ...l, dup, include: l.ok && !dup, periodText: l.period ? shortYm(l.period) : '', amountText: formatAmount(l.amountCents) };
    }));
  };

  const set = (i: number, patch: Partial<Row>) => setRows(r => r!.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const valid = (r: Row) => (r.periodText.trim() === '' || parsePeriodInput(r.periodText) !== null) && parseAmount(r.amountText) !== null;
  const chosen = rows?.filter(r => r.include && valid(r)) ?? [];

  const doImport = () => {
    const base = Date.now();
    let lastAt = todayIso().slice(0, 7);
    const items: Payment[] = [];
    rows!.forEach((r, i) => {
      const period = r.periodText.trim() ? parsePeriodInput(r.periodText)! : undefined;
      if (period) lastAt = period;
      if (!r.include || !valid(r)) return;
      items.push({
        id: newId(), period, at: period ?? lastAt, amountCents: parseAmount(r.amountText), currency: r.currency,
        method: r.method, note: r.note, createdAt: new Date(base + i).toISOString(),
      });
    });
    onImport(items);
  };

  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal wide" onClick={e => e.stopPropagation()} role="dialog" aria-label="Zalijepi stare zapise">
        <h2>Zalijepi stare zapise · {name}</h2>
        {!rows ? (
          <>
            <p className="modal-lead">Kopiraj popis iz bilješki i zalijepi ga ovdje. Svaki redak je jedno plaćanje, npr. <code>11/25 - 40 aircash</code>. Prije spremanja vidjet ćeš što je prepoznato.</p>
            <textarea className="paste" value={text} onChange={e => setText(e.target.value)} placeholder={EXAMPLE} autoFocus rows={12} spellCheck={false} />
            <div className="modal-actions">
              <span />
              <button type="button" className="link" onClick={onCancel}>Odustani</button>
              <button type="button" className="primary" disabled={!text.trim()} onClick={analyze}>Prepoznaj zapise</button>
            </div>
          </>
        ) : (
          <>
            <p className="modal-lead">
              Prepoznato {rows.filter(r => r.ok).length} od {rows.length} redaka. Ispravi što treba i makni kvačicu s redaka koje ne želiš.
              {rows.some(r => r.dup) && ' Mjeseci koji već postoje nisu označeni.'}
            </p>
            <div className="import-table-wrap">
              <table className="import-table">
                <thead>
                  <tr><th aria-label="Uvezi" /><th>Iz bilješke</th><th>Mjesec</th><th>Iznos</th><th>Način</th><th>Napomena</th></tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={(!r.ok ? 'bad ' : '') + (r.include ? '' : 'off')}>
                      <td><input type="checkbox" checked={r.include} onChange={e => set(i, { include: e.target.checked })} aria-label="Uvezi redak" /></td>
                      <td className="raw">{r.raw}{r.error && <span className="row-err">{r.error}</span>}{r.dup && <span className="row-dup">već postoji</span>}</td>
                      <td><input className={'cell w-per' + (r.periodText && !parsePeriodInput(r.periodText) ? ' bad' : '')} value={r.periodText} placeholder="posebna" onChange={e => set(i, { periodText: e.target.value })} aria-label="Mjesec" /></td>
                      <td className="amt-cell">
                        <input className={'cell w-amt2' + (parseAmount(r.amountText) === null ? ' bad' : '')} value={r.amountText} onChange={e => set(i, { amountText: e.target.value, include: true })} aria-label="Iznos" />
                        <span className="cur">{currencyLabel(r.currency)}</span>
                      </td>
                      <td>
                        <select className="cell" value={r.method ?? ''} onChange={e => set(i, { method: e.target.value || undefined })} aria-label="Način plaćanja">
                          <option value="">–</option>
                          {[...new Set([...methods, ...(r.method ? [r.method] : [])])].map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </td>
                      <td><input className="cell" value={r.note ?? ''} onChange={e => set(i, { note: e.target.value || undefined })} aria-label="Napomena" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-actions">
              <button type="button" className="link" onClick={() => setRows(null)}>Natrag na tekst</button>
              <button type="button" className="link" onClick={onCancel}>Odustani</button>
              <button type="button" className="primary" disabled={!chosen.length} onClick={doImport}>Spremi {plural(chosen.length, 'zapis', 'zapisa', 'zapisa')}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

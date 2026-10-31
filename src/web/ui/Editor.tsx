import { useEffect, useMemo, useState } from 'react';
import { buildHub3, formatAmount, hasErrors, parseAmount, validate } from '../../shared/hub3';
import { formatIban } from '../../shared/iban';
import { fillPlaceholders, periodLabel, shiftPeriod, PLACEHOLDER_HELP } from '../../shared/placeholders';
import { PURPOSES, PURPOSE_MAP } from '../../shared/purpose';
import { MODELS } from '../../shared/reference';
import { MAX } from '../../shared/text';
import type { FieldKey, Issue, OwnerRef, Payment, Slip, Template } from '../../shared/types';
import { todayIso, ym } from '../../shared/history';
import { PaymentDialog } from './PaymentDialog';
import { useReceipts } from './receipts';
import { matrixToCanvas, matrixToSvg, pdf417Matrix } from '../lib/barcode';
import { buildPdf, pdfFileName } from '../lib/pdf';
import { addPayments, newId, rememberMethod, type Store } from '../lib/storage';
import { downloadBlob } from './download';
import { draftUsesPlaceholders, effectiveSlip, suggestPlaceholders, type Draft, type Suggestion } from './draft';
import { Field, SelectField } from './fields';

interface Props {
  draft: Draft;
  setDraft: (fn: (d: Draft) => Draft) => void;
  store: Store;
  update: (fn: (s: Store) => Store) => void;
  goProfile: () => void;
  toast: (msg: string) => void;
  onNew: () => void;
  onRecorded: (ref: OwnerRef, paymentId: string) => void;
}

const COMMON_MODELS = ['HR00', 'HR01', 'HR99', 'HR68', 'HR69'];
// Web Share with files is only useful on touch devices
const canShareFiles = typeof navigator !== 'undefined' && !!navigator.canShare && matchMedia('(pointer: coarse)').matches;
const GROUPS = [...new Set(PURPOSES.map(p => p.group))];

export function Editor({ draft, setDraft, store, update, goProfile, toast, onNew, onRecorded }: Props) {
  const { slip } = draft;
  const profile = store.profile;
  const profileFilled = !!profile.name.trim();
  const template = draft.templateId ? store.templates.find(t => t.id === draft.templateId) : undefined;

  const eff = useMemo(() => effectiveSlip(draft, profile), [draft, profile]);
  const issues = useMemo(() => validate(eff), [eff]);
  const blocked = hasErrors(issues);
  const issueOf = (f: FieldKey): Issue | undefined => issues.find(i => i.field === f && i.level === 'error') ?? issues.find(i => i.field === f);

  // show errors only once a field was touched or after a download attempt
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());
  const [showAll, setShowAll] = useState(false);
  useEffect(() => { setTouched(new Set()); setShowAll(!!draft.templateId || !!draft.slip.payee.iban); }, [draft.key]);
  const touch = (f: FieldKey) => setTouched(t => (t.has(f) ? t : new Set(t).add(f)));
  const visible = (f: FieldKey) => {
    const i = issueOf(f);
    if (!i) return undefined;
    if (showAll || touched.has(f)) return i;
    if (i.level === 'warning' && (f === 'reference' || f === 'payee.iban')) return i;
    return undefined;
  };

  const set = (fn: (s: Slip) => Slip, f?: FieldKey) => {
    setDraft(d => ({ ...d, slip: fn(d.slip) }));
    if (f) touch(f);
  };

  const matrix = useMemo(() => (blocked ? null : pdf417Matrix(buildHub3(eff))), [blocked, eff]);
  const svg = useMemo(() => (matrix ? matrixToSvg(matrix) : ''), [matrix]);
  const placeholders = draftUsesPlaceholders(slip);

  const [big, setBig] = useState(false);
  const [saving, setSaving] = useState<null | { name: string; desc: Suggestion | null }>(null);
  const [recording, setRecording] = useState(false);
  const { upload: uploadReceipts } = useReceipts();

  const requireValid = () => {
    if (!matrix) {
      setShowAll(true);
      toast('Uplatnica još nije potpuna. Ispravi označena polja.');
      return false;
    }
    return true;
  };

  const markUsed = () => {
    if (template) update(s => ({ ...s, templates: s.templates.map(t => (t.id === template.id ? { ...t, lastUsedAt: new Date().toISOString() } : t)) }));
  };

  const downloadPdf = () => {
    if (!requireValid()) return;
    const doc = buildPdf({ slip: eff, matrix: matrix!, payerIban: draft.useProfile ? profile.iban : undefined, title: template?.name });
    downloadBlob(doc.output('blob'), pdfFileName(eff));
    markUsed();
  };

  // On phones the image is shared (e.g. saved to the gallery for the banking app); elsewhere it is downloaded.
  const downloadPng = () => {
    if (!requireValid()) return;
    const name = pdfFileName(eff).replace(/\.pdf$/, '.png');
    matrixToCanvas(matrix!, 4).toBlob(async b => {
      if (!b) return;
      const file = new File([b], name, { type: 'image/png' });
      if (canShareFiles && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: eff.payee.name });
        } catch { /* user cancelled */ }
      } else downloadBlob(b, name);
    });
    markUsed();
  };
  const pngUrl = useMemo(() => (big && matrix ? matrixToCanvas(matrix, 6).toDataURL('image/png') : ''), [big, matrix]);

  const startSave = () => {
    let desc = suggestPlaceholders(slip.description, draft.period);
    if (desc) {
      // use the month from the text only if it is close to the current one; a stale description (e.g. 05/25) follows the selected month
      const diff = (desc.period.year * 12 + desc.period.month) - (draft.period.year * 12 + draft.period.month);
      if (diff < -1 || diff > 2) desc = { ...desc, period: draft.period };
    }
    setSaving({ name: template?.name ?? slip.payee.name.trim(), desc });
  };

  const saveTemplate = (asNew: boolean, name: string, useSuggestion: boolean, suggestion: Suggestion | null) => {
    const now = new Date().toISOString();
    const s: Slip = structuredClone(slip);
    s.amountCents = parseAmount(draft.amountText);
    const sug = useSuggestion ? suggestion : null;
    if (sug) s.description = sug.text;
    if (draft.useProfile) s.payer = { name: '', street: '', city: '' };
    if (template && !asNew) {
      update(st => ({ ...st, templates: st.templates.map(t => (t.id === template.id ? { ...t, name, slip: s, useProfile: draft.useProfile, updatedAt: now } : t)) }));
      toast(`Predložak „${name}" je spremljen.`);
      setDraft(d => ({ ...d, period: sug ? sug.period : d.period, slip: { ...d.slip, description: s.description } }));
    } else {
      const t: Template = { id: newId(), name, slip: s, useProfile: draft.useProfile, createdAt: now, updatedAt: now, payments: [], pauseMonths: [] };
      update(st => ({ ...st, templates: [t, ...st.templates] }));
      setDraft(d => ({ ...d, templateId: t.id, period: sug ? sug.period : d.period, slip: { ...d.slip, description: s.description } }));
      toast(`Predložak „${name}" je spremljen.`);
    }
    setSaving(null);
  };

  const recordPayment = (p: Payment, dest: { value: string; newName: string } | undefined, files: File[]) => {
    let ref: OwnerRef;
    if (template) ref = { kind: 'template', id: template.id };
    else if (dest?.value === 'new-template') {
      const now = new Date().toISOString();
      const s: Slip = structuredClone(slip);
      s.amountCents = parseAmount(draft.amountText);
      if (draft.useProfile) s.payer = { name: '', street: '', city: '' };
      const t: Template = { id: newId(), name: dest.newName, slip: s, useProfile: draft.useProfile, createdAt: now, updatedAt: now, payments: [], pauseMonths: [] };
      update(st => ({ ...st, templates: [t, ...st.templates] }));
      setDraft(d => ({ ...d, templateId: t.id }));
      ref = { kind: 'template', id: t.id };
    } else {
      const [kind, id] = dest!.value.split(':') as ['template' | 'tracker', string];
      ref = { kind, id };
    }
    update(st => rememberMethod(addPayments(st, ref, [p]), p.method));
    setRecording(false);
    markUsed();
    toast(`Zabilježeno: ${p.period ? p.period.slice(5, 7) + '/' + p.period.slice(2, 4) : 'posebna uplata'}, ${formatAmount(p.amountCents)} ${p.currency === 'EUR' ? 'EUR' : 'kn'}.`);
    onRecorded(ref, p.id);
    if (files.length) void uploadReceipts(p.id, files);
  };

  const errorsLeft = issues.filter(i => i.level === 'error');

  return (
    <div className="editor">
      <section className="sheet" aria-label="Uplatnica">
        <header className="sheet-head">
          <div>
            <h1>{template ? template.name : 'Nova uplatnica'}</h1>
            <p className="sub">
              {template ? 'Otvoren predložak. Promjene vrijede za ovu uplatnicu dok ih ne spremiš u predložak.' : 'Jednokratna uplata se nigdje ne sprema, osim ako je spremiš kao predložak.'}
            </p>
          </div>
          {placeholders && (
            <div className="period" role="group" aria-label="Mjesec uplate">
              <button className="icon" onClick={() => setDraft(d => ({ ...d, period: shiftPeriod(d.period, -1) }))} aria-label="Prethodni mjesec">‹</button>
              <span>Za {periodLabel(draft.period)}</span>
              <button className="icon" onClick={() => setDraft(d => ({ ...d, period: shiftPeriod(d.period, 1) }))} aria-label="Sljedeći mjesec">›</button>
            </div>
          )}
        </header>

        <div className="slip" key={draft.key}>
          <div className="slip-title">
            <span>Nalog za plaćanje</span>
            <span>HUB-3A</span>
          </div>
          <div className="slip-grid">
            <div className="col-left">
              <fieldset className="party">
                <legend>Platitelj (naziv/ime i adresa)</legend>
                <label className="toggle">
                  <input type="checkbox" checked={draft.useProfile} onChange={e => setDraft(d => ({ ...d, useProfile: e.target.checked }))} />
                  <span>Moj profil</span>
                </label>
                {draft.useProfile ? (
                  profileFilled ? (
                    <div className="from-profile">
                      <p>{profile.name}</p>
                      <p>{profile.street}</p>
                      <p>{profile.city}</p>
                    </div>
                  ) : (
                    <div className="from-profile empty">
                      <p>Profil još nije ispunjen.</p>
                      <button className="link" onClick={goProfile}>Upiši svoje podatke</button>
                    </div>
                  )
                ) : (
                  <>
                    <Field label="Ime i prezime" value={slip.payer.name} max={MAX['payer.name']} issue={visible('payer.name')}
                      onChange={v => set(s => ({ ...s, payer: { ...s.payer, name: v } }), 'payer.name')} />
                    <Field label="Ulica i broj" value={slip.payer.street} max={MAX['payer.street']} issue={visible('payer.street')}
                      onChange={v => set(s => ({ ...s, payer: { ...s.payer, street: v } }), 'payer.street')} />
                    <Field label="Poštanski broj i mjesto" value={slip.payer.city} max={MAX['payer.city']} issue={visible('payer.city')}
                      onChange={v => set(s => ({ ...s, payer: { ...s.payer, city: v } }), 'payer.city')} />
                  </>
                )}
              </fieldset>

              <fieldset className="party">
                <legend>Primatelj (naziv/ime i adresa)</legend>
                <Field label="Naziv" value={slip.payee.name} max={MAX['payee.name']} issue={visible('payee.name')}
                  onChange={v => set(s => ({ ...s, payee: { ...s.payee, name: v } }), 'payee.name')} />
                <Field label="Ulica i broj" value={slip.payee.street} max={MAX['payee.street']} issue={visible('payee.street')}
                  onChange={v => set(s => ({ ...s, payee: { ...s.payee, street: v } }), 'payee.street')} />
                <Field label="Poštanski broj i mjesto" value={slip.payee.city} max={MAX['payee.city']} issue={visible('payee.city')}
                  onChange={v => set(s => ({ ...s, payee: { ...s.payee, city: v } }), 'payee.city')} />
              </fieldset>
            </div>

            <div className="col-right">
              <div className="row">
                <div className="fld fixed w-cur"><label>Valuta</label><output>EUR</output></div>
                <Field label="Iznos" className="w-amt" big mono inputMode="decimal" placeholder="0,00" value={draft.amountText} issue={visible('amount')}
                  onChange={v => { setDraft(d => ({ ...d, amountText: v, slip: { ...d.slip, amountCents: parseAmount(v) } })); touch('amount'); }}
                  onBlur={() => setDraft(d => (d.slip.amountCents !== null ? { ...d, amountText: formatAmount(d.slip.amountCents) } : d))} />
              </div>
              <Field label="IBAN primatelja" mono value={slip.payee.iban} issue={visible('payee.iban')} placeholder="HR00 0000 0000 0000 0000 0"
                onChange={v => set(s => ({ ...s, payee: { ...s.payee, iban: v.toUpperCase() } }), 'payee.iban')}
                onBlur={() => set(s => ({ ...s, payee: { ...s.payee, iban: formatIban(s.payee.iban) } }))} />
              <div className="row">
                <SelectField label="Model" className="w-model" value={slip.model} issue={visible('model')}
                  onChange={v => set(s => ({ ...s, model: v, reference: v === 'HR99' ? '' : s.reference }), 'model')}>
                  <optgroup label="Najčešći">
                    {COMMON_MODELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </optgroup>
                  <optgroup label="Svi modeli">
                    {MODELS.filter(m => !COMMON_MODELS.includes(m.code)).map(m => <option key={m.code} value={m.code}>{m.code}</option>)}
                  </optgroup>
                </SelectField>
                <Field label="Poziv na broj primatelja" className="w-ref" mono value={slip.reference} max={MAX.reference} issue={visible('reference')}
                  disabled={slip.model === 'HR99'} placeholder={slip.model === 'HR99' ? 'Nije potreban' : 'npr. 1234-5678'}
                  filled={eff.reference}
                  hint={slip.model === 'HR00' && !slip.reference.trim() ? 'Prazno: uplata bez poziva na broj (model HR99)' : MODELS.find(m => m.code === slip.model)?.label}
                  onChange={v => set(s => ({ ...s, reference: v.replace(/\s/g, '') }), 'reference')} />
              </div>
              <div className="row">
                <SelectField label="Šifra namjene" className="w-purpose" value={slip.purpose} issue={visible('purpose')}
                  onChange={v => set(s => ({ ...s, purpose: v }), 'purpose')}>
                  {!PURPOSE_MAP.has(slip.purpose) && <option value={slip.purpose}>{slip.purpose}</option>}
                  {GROUPS.map(g => (
                    <optgroup key={g} label={g}>
                      {PURPOSES.filter(p => p.group === g).map(p => <option key={p.code} value={p.code}>{p.code} – {p.label}</option>)}
                    </optgroup>
                  ))}
                </SelectField>
              </div>
              <Field label="Opis plaćanja" value={slip.description} max={MAX.description} issue={visible('description')}
                filled={eff.description}
                hint={placeholders && eff.description !== slip.description ? <>Na uplatnici: <b>{eff.description}</b></> : <>Za automatski mjesec upiši {PLACEHOLDER_HELP.slice(0, 1).map(h => <code key={h.token}>{h.token}</code>)} i <code>{'{godina}'}</code>.</>}
                onChange={v => set(s => ({ ...s, description: v }), 'description')} />
            </div>
          </div>
        </div>
      </section>

      <aside className="preview" aria-label="Barkod">
        <div className={'code' + (matrix ? '' : ' is-empty')}>
          {matrix ? (
            <button className="code-btn" onClick={() => setBig(true)} title="Prikaži preko cijelog zaslona" dangerouslySetInnerHTML={{ __html: svg }} />
          ) : (
            <div className="code-wait">
              <p>Barkod se pojavi kad su sva obavezna polja ispravna.</p>
              {errorsLeft.length > 0 && (
                <ul>
                  {errorsLeft.slice(0, 4).map(i => <li key={i.field + i.message}>{i.message}</li>)}
                </ul>
              )}
            </div>
          )}
        </div>
        {matrix && <p className="scan-tip">Skeniraj mobitelom s ekrana. Klik na barkod ga povećava.</p>}

        <dl className="summary">
          <div><dt>Iznos</dt><dd className="amt">{eff.amountCents ? `${formatAmount(eff.amountCents)} EUR` : '–'}</dd></div>
          <div><dt>Primatelj</dt><dd>{eff.payee.name || '–'}</dd></div>
          <div><dt>Opis</dt><dd>{eff.description || '–'}</dd></div>
        </dl>

        <div className="actions">
          <button className="primary" onClick={downloadPdf}>Preuzmi PDF uplatnicu</button>
          <button className="record" onClick={() => setRecording(true)}>Zabilježi plaćanje</button>
          <button onClick={downloadPng}>{canShareFiles ? 'Podijeli sliku barkoda' : 'Preuzmi sliku barkoda'}</button>
          <button onClick={startSave}>{template ? 'Spremi u predložak' : 'Spremi kao predložak'}</button>
          <button className="link" onClick={onNew}>Nova prazna uplatnica</button>
        </div>
      </aside>

      {big && matrix && (
        <div className="overlay" role="dialog" aria-modal="true" aria-label="Barkod preko cijelog zaslona" onClick={() => setBig(false)}
          onKeyDown={e => e.key === 'Escape' && setBig(false)} tabIndex={-1} ref={el => el?.focus()}>
          <img className="overlay-code" src={pngUrl} alt="PDF417 barkod uplatnice" />
          <p>{formatAmount(eff.amountCents)} EUR · {eff.payee.name}</p>
          <p className="overlay-hint">Na mobitelu dugo pritisni sliku za spremanje u galeriju.</p>
          <button className="overlay-close" onClick={() => setBig(false)}>Zatvori</button>
        </div>
      )}

      {recording && (
        <PaymentDialog
          title={template ? `Zabilježi plaćanje · ${template.name}` : 'Zabilježi plaćanje'}
          initial={{
            period: ym(draft.period.year, draft.period.month),
            amountCents: eff.amountCents,
            currency: 'EUR',
            paidOn: todayIso(),
            method: [...(template?.payments ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).find(x => x.method)?.method ?? store.lastMethod,
          }}
          methods={store.methods}
          existing={template?.payments ?? []}
          destinations={template ? undefined : {
            initial: eff.payee.name.trim() ? 'new-template' : '',
            newName: eff.payee.name,
            options: [
              ...store.templates.map(t => ({ value: 'template:' + t.id, label: 'Predložak: ' + t.name })),
              ...store.trackers.map(t => ({ value: 'tracker:' + t.id, label: 'Evidencija: ' + t.name })),
            ],
          }}
          saveLabel="Zabilježi"
          onCancel={() => setRecording(false)}
          onSave={recordPayment}
        />
      )}

      {saving && (
        <SaveDialog
          initialName={saving.name}
          suggestion={saving.desc}
          original={slip.description}
          isUpdate={!!template}
          onCancel={() => setSaving(null)}
          onSave={saveTemplate}
        />
      )}
    </div>
  );
}

function SaveDialog(p: {
  initialName: string; suggestion: Suggestion | null; original: string; isUpdate: boolean;
  onCancel: () => void; onSave: (asNew: boolean, name: string, useSuggestion: boolean, suggestion: Suggestion | null) => void;
}) {
  const [name, setName] = useState(p.initialName);
  const [useSug, setUseSug] = useState(true);
  const ok = name.trim().length > 0;
  return (
    <div className="modal-back" onClick={p.onCancel}>
      <form className="modal" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); if (ok) p.onSave(false, name.trim(), useSug, p.suggestion); }}>
        <h2>{p.isUpdate ? 'Spremi promjene u predložak' : 'Spremi kao predložak'}</h2>
        <div className="fld plain">
          <label htmlFor="tpl-name">Naziv predloška</label>
          <input id="tpl-name" autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="npr. Nogomet – Luka" />
        </div>
        {p.suggestion && (
          <label className="suggest">
            <input type="checkbox" checked={useSug} onChange={e => setUseSug(e.target.checked)} />
            <span>
              Neka se mjesec u opisu sam mijenja.
              <span className="from-to"><s>{p.original}</s><b>{p.suggestion.text}</b><span className="dim-small">Za {periodLabel(p.suggestion.period)} na uplatnici piše: {fillPlaceholders(p.suggestion.text, p.suggestion.period)}</span></span>
            </span>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="link" onClick={p.onCancel}>Odustani</button>
          {p.isUpdate && <button type="button" disabled={!ok} onClick={() => p.onSave(true, name.trim(), useSug, p.suggestion)}>Spremi kao novi</button>}
          <button type="submit" className="primary" disabled={!ok}>Spremi</button>
        </div>
      </form>
    </div>
  );
}

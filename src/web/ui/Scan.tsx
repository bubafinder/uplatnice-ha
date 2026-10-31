import { useEffect, useRef, useState } from 'react';
import { formatAmount, parseHub3 } from '../../shared/hub3';
import { formatIban } from '../../shared/iban';
import type { Slip } from '../../shared/types';
import { decodeFile } from '../lib/scan';

interface Props {
  openSlip: (s: Slip) => void;
  saveAsTemplate: (s: Slip, name: string) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'busy'; msg: string }
  | { kind: 'error'; msg: string }
  | { kind: 'done'; slip: Slip; file: string };

export function Scan({ openSlip, saveAsTemplate }: Props) {
  const [st, setSt] = useState<State>({ kind: 'idle' });
  const [drag, setDrag] = useState(false);
  const [name, setName] = useState('');
  const input = useRef<HTMLInputElement>(null);

  const handle = async (file: File) => {
    setSt({ kind: 'busy', msg: `Tražim barkod u datoteci ${file.name}…` });
    try {
      const text = await decodeFile(file, (n, total) => setSt({ kind: 'busy', msg: `Tražim barkod, stranica ${n} od ${total}…` }));
      if (!text) {
        setSt({ kind: 'error', msg: 'Barkod nije pronađen. Pokušaj s oštrijom slikom na kojoj je barkod velik i ravan, ili s originalnim PDF-om računa.' });
        return;
      }
      const slip = parseHub3(text);
      setName(slip.payee.name);
      setSt({ kind: 'done', slip, file: file.name });
    } catch (e) {
      setSt({ kind: 'error', msg: e instanceof Error ? e.message : 'Datoteku nije moguće pročitati.' });
    }
  };

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find(x => x.type.startsWith('image/') || x.type === 'application/pdf');
      if (f) { e.preventDefault(); handle(new File([f], f.name || 'zalijepljena-slika.png', { type: f.type })); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const s = st.kind === 'done' ? st.slip : null;

  return (
    <section className="page">
      <header className="page-head">
        <h1>Učitaj postojeću uplatnicu</h1>
      </header>
      <p className="lead">Učitaj račun ili uplatnicu s barkodom: PDF, sliku ili snimku zaslona. Podatke prepišem iz barkoda pa od njih možeš napraviti predložak. Datoteka ne napušta tvoje računalo.</p>

      <div
        className={'drop' + (drag ? ' is-drag' : '') + (st.kind === 'busy' ? ' is-busy' : '')}
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}
      >
        {st.kind === 'busy' ? (
          <p className="drop-busy"><span className="spinner" aria-hidden />{st.msg}</p>
        ) : (
          <>
            <p className="drop-main">Povuci datoteku ovamo</p>
            <p className="drop-sub">ili <button className="link" onClick={() => input.current?.click()}>odaberi s računala</button>, ili zalijepi snimku zaslona (Ctrl+V)</p>
          </>
        )}
        <input ref={input} type="file" accept="application/pdf,image/*" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = ''; }} />
      </div>

      {st.kind === 'error' && <p className="alert" role="alert">{st.msg}</p>}

      {s && (
        <div className="found">
          <h2>Pronađena uplatnica</h2>
          <dl className="found-grid">
            <div><dt>Primatelj</dt><dd>{[s.payee.name, s.payee.street, s.payee.city].filter(Boolean).join(', ')}</dd></div>
            <div><dt>IBAN</dt><dd className="mono">{formatIban(s.payee.iban)}</dd></div>
            <div><dt>Iznos</dt><dd>{s.amountCents ? `${formatAmount(s.amountCents)} EUR` : '–'}</dd></div>
            <div><dt>Model i poziv na broj</dt><dd className="mono">{[s.model, s.reference].filter(Boolean).join(' ') || '–'}</dd></div>
            <div><dt>Šifra namjene</dt><dd>{s.purpose}</dd></div>
            <div><dt>Opis</dt><dd>{s.description || '–'}</dd></div>
            {s.payer.name && <div><dt>Platitelj</dt><dd>{[s.payer.name, s.payer.street, s.payer.city].filter(Boolean).join(', ')}</dd></div>}
          </dl>
          <form className="found-actions" onSubmit={e => { e.preventDefault(); if (name.trim()) saveAsTemplate(s, name.trim()); }}>
            <div className="fld plain grow">
              <label htmlFor="scan-name">Naziv predloška</label>
              <input id="scan-name" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <button type="submit" className="primary" disabled={!name.trim()}>Spremi kao predložak</button>
            <button type="button" onClick={() => openSlip(s)}>Otvori kao uplatnicu</button>
          </form>
        </div>
      )}
    </section>
  );
}

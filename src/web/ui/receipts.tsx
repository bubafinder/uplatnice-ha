// Payment confirmations: upload actions, a file picker for the payment dialog, and a viewer/manager dialog.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { AppState } from '../../shared/state';
import type { Payment, ReceiptMeta } from '../../shared/types';
import { api, receiptsZipUrl } from '../lib/api';
import { ACCEPT_RECEIPTS, formatSize, prepareReceipt } from '../lib/images';
import { loadPdfJs } from '../lib/scan';
import { downloadBlob } from './download';

export { receiptsZipUrl };

interface ReceiptActions {
  /** Uploads files for a payment; the payment is saved first if it is new. Returns how many were stored. */
  upload: (paymentId: string, files: File[]) => Promise<number>;
  remove: (receiptId: string) => Promise<void>;
}

const Ctx = createContext<ReceiptActions | null>(null);

export function ReceiptsProvider(p: { ensureSynced: () => Promise<void>; replace: (s: AppState) => void; toast: (m: string) => void; children: ReactNode }) {
  const { ensureSynced, replace, toast } = p;
  const upload = useCallback(async (paymentId: string, files: File[]) => {
    if (!files.length) return 0;
    let stored = 0;
    try {
      await ensureSynced();
      for (const f of files) {
        toast(files.length > 1 ? `Spremam potvrdu ${stored + 1} od ${files.length}…` : 'Spremam potvrdu…');
        const prepared = await prepareReceipt(f);
        const { state } = await api.uploadReceipt(paymentId, prepared.blob, prepared.name);
        replace(state);
        stored++;
      }
      toast(stored === 1 ? 'Potvrda je spremljena.' : `Spremljeno potvrda: ${stored}.`);
    } catch (e) {
      toast(`Potvrda nije spremljena: ${e instanceof Error ? e.message : 'greška'}`);
    }
    return stored;
  }, [ensureSynced, replace, toast]);

  const remove = useCallback(async (receiptId: string) => {
    try {
      replace(await api.deleteReceipt(receiptId));
      toast('Potvrda je obrisana.');
    } catch (e) {
      toast(`Potvrda nije obrisana: ${e instanceof Error ? e.message : 'greška'}`);
    }
  }, [replace, toast]);

  return <Ctx.Provider value={{ upload, remove }}>{p.children}</Ctx.Provider>;
}

export function useReceipts(): ReceiptActions {
  const c = useContext(Ctx);
  if (!c) throw new Error('ReceiptsProvider missing');
  return c;
}

/** Collects files from a file input, drag & drop and paste (Ctrl+V). */
function useFileSources(onFiles: (files: File[]) => void, pasteEnabled: boolean) {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!pasteEnabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
      if (!files.length) return;
      e.preventDefault();
      onFiles(files.map(f => new File([f], f.name && f.name !== 'image.png' ? f.name : `snimka-zaslona-${Date.now()}.png`, { type: f.type })));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFiles, pasteEnabled]);
  const dropProps = {
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragging(false); onFiles([...e.dataTransfer.files]); },
  };
  return { dragging, dropProps };
}

const fileIcon = (mime: string) => (mime === 'application/pdf' ? 'PDF' : 'IMG');

/** File picker used inside the payment dialog; files are uploaded after the payment is saved. */
export function ReceiptPicker({ files, setFiles }: { files: File[]; setFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const add = useCallback((more: File[]) => setFiles([...files, ...more]), [files, setFiles]);
  const { dragging, dropProps } = useFileSources(add, true);
  return (
    <div className={'fld plain receipt-picker' + (dragging ? ' is-drag' : '')} {...dropProps}>
      <label>Potvrda plaćanja</label>
      {files.length > 0 && (
        <ul className="picked">
          {files.map((f, i) => (
            <li key={i}>
              <span className="ficon" aria-hidden>{fileIcon(f.type)}</span>
              <span className="fname">{f.name}</span>
              <span className="fsize">{formatSize(f.size)}</span>
              <button type="button" className="link small" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Ukloni ${f.name}`}>Ukloni</button>
            </li>
          ))}
        </ul>
      )}
      <div className="picker-row">
        <button type="button" className="small" onClick={() => input.current?.click()}>{files.length ? 'Dodaj još' : 'Dodaj potvrdu'}</button>
        <span className="picker-hint">PDF ili slika, do 15 MB. Može i povući ili zalijepiti (Ctrl+V).</span>
      </div>
      <input ref={input} type="file" accept={ACCEPT_RECEIPTS} multiple hidden data-testid="receipt-input"
        onChange={e => { add([...(e.target.files ?? [])]); e.target.value = ''; }} />
    </div>
  );
}

/** Renders an image or every page of a PDF receipt. */
function ReceiptPreview({ receipt }: { receipt: ReceiptMeta }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pages = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    (async () => {
      try {
        const blob = await api.receiptBlob(receipt.id);
        if (cancelled) return;
        if (receipt.mime !== 'application/pdf') {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
          return;
        }
        const lib = await loadPdfJs();
        const doc = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
        const host = pages.current;
        if (!host || cancelled) return;
        host.replaceChildren();
        for (let n = 1; n <= Math.min(doc.numPages, 10); n++) {
          const page = await doc.getPage(n);
          const vp = page.getViewport({ scale: Math.min(2, (host.clientWidth || 600) / page.getViewport({ scale: 1 }).width) * (window.devicePixelRatio || 1) });
          const c = document.createElement('canvas');
          c.width = Math.ceil(vp.width);
          c.height = Math.ceil(vp.height);
          c.className = 'pdf-page';
          await page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport: vp, background: '#ffffff' } as any).promise;
          if (cancelled) return;
          host.appendChild(c);
        }
      } catch (e) {
        if (!cancelled) setError(receipt.mime === 'image/heic' || receipt.mime === 'image/heif'
          ? 'Ovaj preglednik ne prikazuje HEIC slike. Preuzmi datoteku za pregled.'
          : e instanceof Error ? e.message : 'Potvrdu nije moguće prikazati.');
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [receipt.id, receipt.mime]);

  if (error) return <p className="preview-error">{error}</p>;
  if (receipt.mime === 'application/pdf') return <div className="pdf-pages" ref={pages} aria-label={`PDF ${receipt.fileName}`}><span className="spinner" aria-hidden /></div>;
  if (!url) return <div className="pdf-pages"><span className="spinner" aria-hidden /></div>;
  return <img className="receipt-img" src={url} alt={receipt.fileName} onError={() => setError('Ovaj preglednik ne prikazuje ovu sliku. Preuzmi datoteku za pregled.')} />;
}

/** Dialog listing a payment's receipts with preview, download, add and delete. */
export function ReceiptsDialog({ payment, title, onClose }: { payment: Payment; title: string; onClose: () => void }) {
  const { upload, remove } = useReceipts();
  const receipts = payment.receipts ?? [];
  const [selected, setSelected] = useState<string | null>(receipts[0]?.id ?? null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const current = receipts.find(r => r.id === selected) ?? receipts[0];

  const add = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    await upload(payment.id, files);
    setBusy(false);
  }, [payment.id, upload]);
  const { dragging, dropProps } = useFileSources(add, true);

  // show a newly added receipt right away; fall back to the last one if the selection was deleted
  const count = useRef(receipts.length);
  useEffect(() => {
    const added = receipts.length > count.current;
    count.current = receipts.length;
    if (added || !receipts.some(r => r.id === selected)) setSelected(receipts[receipts.length - 1]?.id ?? null);
  }, [receipts, selected]);

  const download = async (r: ReceiptMeta) => downloadBlob(await api.receiptBlob(r.id), r.fileName);

  return (
    <div className="modal-back" onClick={onClose}>
      <div className={'modal wide receipts-modal' + (dragging ? ' is-drag' : '')} role="dialog" aria-label="Potvrde plaćanja" onClick={e => e.stopPropagation()} {...dropProps}>
        <div className="receipts-head">
          <h2>Potvrde · {title}</h2>
          <button className="link" onClick={onClose}>Zatvori</button>
        </div>
        {receipts.length === 0 ? (
          <div className="receipts-empty">
            <p>Za ovaj zapis još nema potvrde.</p>
            <p className="picker-hint">Dodaj PDF ili sliku, povuci datoteku ovamo ili zalijepi snimku zaslona (Ctrl+V).</p>
          </div>
        ) : (
          <div className="receipts-body">
            <ul className="receipt-list">
              {receipts.map(r => (
                <li key={r.id} className={r.id === current?.id ? 'is-on' : ''}>
                  <button className="receipt-item" onClick={() => setSelected(r.id)}>
                    <span className="ficon" aria-hidden>{fileIcon(r.mime)}</span>
                    <span className="fname">{r.fileName}</span>
                    <span className="fmeta">{formatSize(r.size)}{r.uploadedBy ? ` · ${r.uploadedBy}` : ''} · {new Date(r.createdAt).toLocaleDateString('hr-HR')}</span>
                  </button>
                </li>
              ))}
            </ul>
            {current && (
              <div className="receipt-view">
                <div className="receipt-actions">
                  <button className="small" onClick={() => download(current)}>Preuzmi</button>
                  {confirm === current.id ? (
                    <>
                      <button className="danger small" onClick={async () => { setConfirm(null); await remove(current.id); }}>Obriši potvrdu</button>
                      <button className="link small" onClick={() => setConfirm(null)}>Odustani</button>
                    </>
                  ) : (
                    <button className="link small danger-link" onClick={() => setConfirm(current.id)}>Obriši…</button>
                  )}
                </div>
                <ReceiptPreview key={current.id} receipt={current} />
              </div>
            )}
          </div>
        )}
        <div className="modal-actions">
          <span />
          <button className="primary" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Spremam…' : 'Dodaj potvrdu'}</button>
          <input ref={input} type="file" accept={ACCEPT_RECEIPTS} multiple hidden data-testid="receipts-dialog-input"
            onChange={e => { add([...(e.target.files ?? [])]); e.target.value = ''; }} />
        </div>
      </div>
    </div>
  );
}

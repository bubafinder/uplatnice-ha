import { useCallback, useEffect, useRef, useState } from 'react';
import { currentPeriod } from '../../shared/placeholders';
import type { OwnerRef, Slip, Template } from '../../shared/types';
import { newId, type Store } from '../lib/storage';
import { draftFromSlip, draftFromTemplate, newDraft, type Draft } from './draft';
import { Editor } from './Editor';
import { History } from './History';
import { ProfileView } from './ProfileView';
import { Scan } from './Scan';
import { Templates } from './Templates';
import { Trackers } from './Trackers';
import { ReceiptsProvider } from './receipts';
import { useStore, type SyncStatus } from './useStore';

type Tab = 'slip' | 'templates' | 'trackers' | 'import' | 'profile';
const TABS: { id: Tab; label: string; short: string; icon: string }[] = [
  { id: 'slip', label: 'Uplatnica', short: 'Uplatnica', icon: 'M4 6h16v12H4zM7 9v6M9.5 9v6M12 9v6M15 9v6M17 9v6' },
  { id: 'templates', label: 'Predlošci', short: 'Predlošci', icon: 'M6 4h12v16H6zM9 8h6M9 12h6M9 16h4' },
  { id: 'trackers', label: 'Evidencije', short: 'Evidencije', icon: 'M5 5h14v14H5zM8 10l2 2 4-4M8 16h8' },
  { id: 'import', label: 'Učitaj', short: 'Učitaj', icon: 'M12 4v11M7 10l5 5 5-5M5 20h14' },
  { id: 'profile', label: 'Moj profil', short: 'Profil', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-4 4.5-6 8-6s6.5 2 8 6' },
];

interface Route { tab: Tab; owner?: OwnerRef; highlight?: string }

const STATUS_TEXT: Record<SyncStatus, string> = {
  loading: 'Učitavam…',
  saved: 'Spremljeno',
  saving: 'Spremam…',
  offline: 'Nema veze s poslužiteljem',
  error: 'Promjene nisu spremljene, pokušavam ponovo',
};

export function App() {
  const { store, update, replace, status, loadError, retry, ensureSynced } = useStore();
  if (!store) {
    return (
      <div className="boot">
        {loadError ? (
          <>
            <p className="boot-title">Aplikacija se ne može povezati s poslužiteljem.</p>
            <p className="boot-sub">{loadError}</p>
            <button className="primary" onClick={retry}>Pokušaj ponovo</button>
          </>
        ) : (
          <p className="boot-sub"><span className="spinner" aria-hidden /> Učitavam podatke…</p>
        )}
      </div>
    );
  }
  return <Loaded store={store} update={update} replace={replace} status={status} ensureSynced={ensureSynced} />;
}

function Loaded({ store, update, replace, status, ensureSynced }: { store: Store; update: (fn: (s: Store) => Store) => void; replace: (s: Store) => void; status: SyncStatus; ensureSynced: () => Promise<void> }) {
  const [route, setRoute] = useState<Route>(() => ({ tab: loadTab() ?? (store.templates.length ? 'templates' : 'slip') }));
  const go = (r: Route) => { setRoute(r); window.scrollTo({ top: 0 }); };
  const profileFilled = !!store.profile.name.trim();
  const [draft, setDraftState] = useState<Draft>(() => newDraft(profileFilled));
  const setDraft = useCallback((fn: (d: Draft) => Draft) => setDraftState(fn), []);

  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const timer = useRef<number>(0);
  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToastMsg(null), 3800);
  }, []);

  useEffect(() => { try { sessionStorage.setItem('uplatnice-tab', route.tab); } catch { /* storage unavailable */ } }, [route.tab]);

  const openTemplate = (t: Template) => {
    setDraftState(draftFromTemplate(t));
    go({ tab: 'slip' });
  };
  const openSlip = (s: Slip) => {
    setDraftState(draftFromSlip(s, profileFilled || !s.payer.name));
    go({ tab: 'slip' });
  };
  const saveScanned = (s: Slip, name: string) => {
    const now = new Date().toISOString();
    const slip = profileFilled ? { ...s, payer: { name: '', street: '', city: '' } } : s;
    const t: Template = { id: newId(), name, slip, useProfile: profileFilled, createdAt: now, updatedAt: now, payments: [], pauseMonths: [] };
    update(st => ({ ...st, templates: [t, ...st.templates] }));
    toast(`Predložak „${name}" je spremljen.`);
    setDraftState({ ...draftFromTemplate(t), period: currentPeriod() });
    go({ tab: 'slip' });
  };

  const historyOf = (ref: OwnerRef, highlight?: string) => go({ tab: ref.kind === 'template' ? 'templates' : 'trackers', owner: ref, highlight });
  const counts: Partial<Record<Tab, number>> = { templates: store.templates.length, trackers: store.trackers.length };

  return (
    <ReceiptsProvider ensureSynced={ensureSynced} replace={replace} toast={toast}>
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 28 20" aria-hidden width="28" height="20"><g fill="currentColor"><rect x="0" y="0" width="3" height="20" /><rect x="5" y="0" width="1.5" height="20" /><rect x="8.5" y="0" width="4" height="20" /><rect x="14.5" y="0" width="1.5" height="20" /><rect x="18" y="0" width="3" height="20" /><rect x="23" y="0" width="1.5" height="20" /><rect x="26" y="0" width="2" height="20" /></g></svg>
          <span>Uplatnice</span>
        </div>
        <nav className="top-nav" aria-label="Glavni izbornik">
          {TABS.map(t => (
            <button key={t.id} className={'tab' + (route.tab === t.id ? ' is-active' : '')} aria-current={route.tab === t.id ? 'page' : undefined} onClick={() => go({ tab: t.id })}>
              {t.label}
              {!!counts[t.id] && <span className="badge">{counts[t.id]}</span>}
            </button>
          ))}
        </nav>
        <span className={'sync sync-' + status} role="status" title={STATUS_TEXT[status]}>
          <span className="dot" aria-hidden />
          <span className="sync-text">{STATUS_TEXT[status]}</span>
        </span>
      </header>

      <main>
        {route.tab === 'slip' && (
          <Editor draft={draft} setDraft={setDraft} store={store} update={update} toast={toast}
            goProfile={() => go({ tab: 'profile' })} onNew={() => setDraftState(newDraft(profileFilled))}
            onRecorded={(ref, id) => historyOf(ref, id)} />
        )}
        {route.owner && (route.tab === 'templates' || route.tab === 'trackers') && (
          <History
            key={route.owner.id}
            ownerRef={route.owner}
            store={store}
            update={update}
            toast={toast}
            highlight={route.highlight}
            back={() => go({ tab: route.tab })}
            openSlip={route.owner.kind === 'template' ? () => {
              const t = store.templates.find(x => x.id === route.owner!.id);
              if (t) openTemplate(t);
            } : undefined}
          />
        )}
        {route.tab === 'templates' && !route.owner && (
          <Templates store={store} openSlip={openTemplate} openHistory={t => historyOf({ kind: 'template', id: t.id })}
            goNew={() => { setDraftState(newDraft(profileFilled)); go({ tab: 'slip' }); }} goScan={() => go({ tab: 'import' })} />
        )}
        {route.tab === 'trackers' && !route.owner && (
          <Trackers store={store} update={update} toast={toast} open={t => historyOf({ kind: 'tracker', id: t.id })} />
        )}
        {route.tab === 'import' && <Scan openSlip={openSlip} saveAsTemplate={saveScanned} />}
        {route.tab === 'profile' && <ProfileView store={store} replace={replace} update={update} toast={toast} />}
      </main>

      <nav className="bottom-nav" aria-label="Glavni izbornik">
        {TABS.map(t => (
          <button key={t.id} className={route.tab === t.id ? 'is-active' : ''} aria-current={route.tab === t.id ? 'page' : undefined} onClick={() => go({ tab: t.id })}>
            <svg viewBox="0 0 24 24" aria-hidden width="22" height="22"><path d={t.icon} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{t.short}</span>
          </button>
        ))}
      </nav>

      <div className={'toast' + (toastMsg ? ' is-on' : '')} role="status" aria-live="polite">{toastMsg}</div>
    </div>
    </ReceiptsProvider>
  );
}

function loadTab(): Tab | null {
  try {
    const t = sessionStorage.getItem('uplatnice-tab') as Tab | null;
    return t && TABS.some(x => x.id === t) ? t : null;
  } catch {
    return null;
  }
}

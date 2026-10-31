// State hook: optimistic local updates, synced to the server as minimal operations.
import { useCallback, useEffect, useRef, useState } from 'react';
import { diffState, type AppState } from '../../shared/state';
import { api } from '../lib/api';
import type { Store } from '../lib/storage';

export type SyncStatus = 'loading' | 'saved' | 'saving' | 'offline' | 'error';

const FLUSH_DELAY = 350;
const REFRESH_EVERY = 60_000;

export function useStore() {
  const [store, setStoreState] = useState<Store | null>(null);
  const [status, setStatus] = useState<SyncStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const local = useRef<Store | null>(null); // latest optimistic state
  const synced = useRef<AppState | null>(null); // last state confirmed by the server
  const timer = useRef<number>(0);
  const inFlight = useRef(false);

  const setLocal = (s: Store) => {
    local.current = s;
    setStoreState(s);
  };

  const load = useCallback(async () => {
    try {
      const s = await api.state();
      // keep unsent local edits
      if (inFlight.current || (local.current && synced.current && diffState(synced.current, local.current).length)) return;
      synced.current = s;
      setLocal(s);
      setStatus('saved');
      setLoadError(null);
    } catch (e) {
      if (!synced.current) setLoadError(e instanceof Error ? e.message : 'Poslužitelj nije dostupan.');
      setStatus('offline');
    }
  }, []);

  const flush = useCallback(async () => {
    if (inFlight.current || !local.current || !synced.current) return;
    const ops = diffState(synced.current, local.current);
    if (!ops.length) return setStatus('saved');
    inFlight.current = true;
    setStatus('saving');
    const sent = local.current;
    try {
      const server = await api.ops(ops);
      synced.current = server;
      // adopt server state (recordedBy, others' changes) unless the user kept editing meanwhile
      if (local.current === sent) setLocal(server);
      setStatus('saved');
    } catch {
      setStatus('error');
    } finally {
      inFlight.current = false;
      if (local.current && synced.current && diffState(synced.current, local.current).length) {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(flush, FLUSH_DELAY * 4);
      }
    }
  }, []);

  const update = useCallback((fn: (s: Store) => Store) => {
    if (!local.current) return;
    setLocal(fn(local.current));
    setStatus('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, FLUSH_DELAY);
  }, [flush]);

  /** Resolves once every local change has been saved (needed before uploading a receipt for a new payment). */
  const ensureSynced = useCallback(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      window.clearTimeout(timer.current);
      while (inFlight.current) await new Promise(r => setTimeout(r, 50));
      if (!local.current || !synced.current || !diffState(synced.current, local.current).length) return;
      await flush();
    }
    throw new Error('Promjene nisu spremljene na poslužitelj.');
  }, [flush]);

  /** Replaces the state with one returned by the server (e.g. after an import). */
  const replace = useCallback((s: AppState) => {
    synced.current = s;
    setLocal(s);
    setStatus('saved');
  }, []);

  useEffect(() => {
    load();
    const refresh = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    const iv = window.setInterval(refresh, REFRESH_EVERY);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (local.current && synced.current && diffState(synced.current, local.current).length) {
        flush();
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('beforeunload', beforeUnload);
      window.clearInterval(iv);
    };
  }, [load, flush]);

  return { store, update, replace, status, loadError, retry: load, flush, ensureSynced };
}

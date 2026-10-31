// Client-side helpers for working with the application state
import type { AppState } from '../../shared/state';
import type { OwnerRef, Payment, Template, Tracker } from '../../shared/types';

export type Store = AppState;

export function exportBackup(s: Store): Blob {
  const { me: _me, ...data } = s;
  return new Blob([JSON.stringify({ version: 2, ...data, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
}

export const newId = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, '').slice(0, 16);

export type Owner = (Template & { kind: 'template' }) | (Tracker & { kind: 'tracker' });

export function getOwner(s: Store, ref: OwnerRef): Owner | undefined {
  if (ref.kind === 'template') {
    const t = s.templates.find(x => x.id === ref.id);
    return t && { ...t, kind: 'template' };
  }
  const t = s.trackers.find(x => x.id === ref.id);
  return t && { ...t, kind: 'tracker' };
}

/** Updates a template or tracker. */
export function updateOwner(s: Store, ref: OwnerRef, fn: (o: { payments: Payment[]; pauseMonths: number[]; name: string }) => Partial<Template & Tracker>): Store {
  const now = new Date().toISOString();
  if (ref.kind === 'template')
    return { ...s, templates: s.templates.map(t => (t.id === ref.id ? { ...t, ...fn(t), updatedAt: now } : t)) };
  return { ...s, trackers: s.trackers.map(t => (t.id === ref.id ? { ...t, ...fn(t), updatedAt: now } : t)) };
}

export function addPayments(s: Store, ref: OwnerRef, items: Payment[]): Store {
  return updateOwner(s, ref, o => ({ payments: [...o.payments, ...items] }));
}

export function rememberMethod(s: Store, method?: string): Store {
  if (!method) return s;
  const methods = s.methods.some(m => m.toLowerCase() === method.toLowerCase()) ? s.methods : [...s.methods, method];
  return { ...s, methods, lastMethod: method };
}

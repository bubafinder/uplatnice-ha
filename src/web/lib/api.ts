// JSON API client. Paths are relative so the app works under the Ingress prefix.
import type { AppState, Op } from '../../shared/state';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) }, credentials: 'same-origin' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  state: () => request<AppState>('api/state'),
  ops: (ops: Op[]) => request<AppState>('api/ops', { method: 'POST', body: JSON.stringify({ ops }) }),
  importBackup: (data: unknown) =>
    request<{ counts: { templates: number; trackers: number; payments: number }; state: AppState }>('api/import', { method: 'POST', body: JSON.stringify(data) }),
};

// JSON API client. Paths are relative so the app works under the Ingress prefix.
import type { AppState, Op } from '../../shared/state';
import type { ReceiptMeta } from '../../shared/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}

export const receiptUrl = (id: string, download = false) => `api/receipts/${encodeURIComponent(id)}${download ? '?download=1' : ''}`;
export const receiptsZipUrl = 'api/receipts.zip';

export const api = {
  state: () => request<AppState>('api/state'),
  ops: (ops: Op[]) => request<AppState>('api/ops', { method: 'POST', body: JSON.stringify({ ops }) }),
  importBackup: (data: unknown) =>
    request<{ counts: { templates: number; trackers: number; payments: number }; state: AppState }>('api/import', { method: 'POST', body: JSON.stringify(data) }),
  uploadReceipt: (paymentId: string, file: Blob, fileName: string) =>
    request<{ receipt: ReceiptMeta; state: AppState }>(`api/payments/${encodeURIComponent(paymentId)}/receipts`, {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(fileName) },
    }),
  deleteReceipt: (id: string) => request<AppState>(receiptUrl(id), { method: 'DELETE' }),
  receiptBlob: async (id: string) => {
    const res = await fetch(receiptUrl(id), { credentials: 'same-origin' });
    if (!res.ok) throw new Error('Potvrdu nije moguće učitati.');
    return res.blob();
  },
};

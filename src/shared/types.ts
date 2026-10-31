export interface Party {
  name: string;
  street: string;
  city: string;
}

/** One payment slip (HUB-3A). Amount is in cents. */
export interface Slip {
  amountCents: number | null;
  payer: Party;
  payee: Party & { iban: string };
  model: string; // npr. "HR01"
  reference: string; // payee reference (poziv na broj)
  purpose: string; // ISO 20022, npr. "OTHR"
  description: string;
}

export interface Profile extends Party {
  iban: string; // payer IBAN, PDF only (not part of the barcode)
}

export type Currency = 'EUR' | 'HRK';

/** A payment record (history). */
export interface Payment {
  id: string;
  period?: string; // 'YYYY-MM' – month paid for; empty = one-off payment
  at: string; // 'YYYY-MM' – used for ordering and grouping by year
  amountCents: number | null;
  currency: Currency;
  paidOn?: string; // 'YYYY-MM-DD'
  method?: string;
  note?: string;
  createdAt: string;
  recordedBy?: string; // set by the server from the Home Assistant user
}

export interface Template {
  id: string;
  name: string;
  slip: Slip; // text fields may contain {mjesec}, {mm}, {gg}, {godina}
  useProfile: boolean; // payer = shared profile
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  payments: Payment[];
  pauseMonths: number[]; // 1-12, months with no payment due
}

/** A tracker without a payment slip (e.g. water, electricity). */
export interface Tracker {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  payments: Payment[];
  pauseMonths: number[];
}

export type OwnerRef = { kind: 'template' | 'tracker'; id: string };

export type FieldKey =
  | 'amount'
  | 'payer.name' | 'payer.street' | 'payer.city'
  | 'payee.name' | 'payee.street' | 'payee.city' | 'payee.iban'
  | 'model' | 'reference' | 'purpose' | 'description';

export interface Issue {
  field: FieldKey;
  level: 'error' | 'warning';
  message: string;
}

export const emptySlip = (): Slip => ({
  amountCents: null,
  payer: { name: '', street: '', city: '' },
  payee: { name: '', street: '', city: '', iban: '' },
  model: 'HR00',
  reference: '',
  purpose: 'OTHR',
  description: '',
});

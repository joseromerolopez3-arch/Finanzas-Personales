export type Kind = 'income' | 'expense';
export type TxType = Kind | 'transfer' | 'adjustment';
export type TxSource = 'manual' | 'import' | 'bank' | 'recurring';

export interface Account {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: 'bank' | 'savings' | 'cash' | 'card' | 'investment' | 'other';
  /** Balance the account had on `openingDate` (before any movement registered in the app). */
  openingBalance: number;
  openingDate: string;
  position: number;
  archived: boolean;
  /** Last column mapping used to import a CSV/Excel file for this account. */
  importMapping: TableMapping | null;
}

export interface Category {
  id: string;
  kind: Kind;
  name: string;
  icon: string;
  color: string;
  position: number;
  archived: boolean;
}

export interface Transaction {
  id: string;
  type: TxType;
  date: string; // YYYY-MM-DD
  /** Always positive, except for `adjustment`, whose sign is the effect on the account. */
  amount: number;
  accountId: string;
  /** Destination account for transfers. */
  toAccountId: string | null;
  categoryId: string | null;
  note: string;
  source: TxSource;
  /** Fingerprint of the bank row this movement is reconciled with (origin account side). */
  externalId: string | null;
  /** Same, for the destination side of a transfer. */
  toExternalId: string | null;
  bankDescription: string | null;
  recurringId: string | null;
  /** Person who entered it (shared households). */
  createdBy: string | null;
  /** Created automatically from the bank and not confirmed yet. */
  needsReview: boolean;
  createdAt: string;
}

export type BudgetMode = 'category' | 'savings';
export type BudgetPattern = 'monthly' | 'annual' | 'months' | 'custom';

export interface BudgetYear {
  id: string; // = String(year)
  year: number;
  mode: BudgetMode;
}

export interface BudgetLine {
  id: string;
  year: number;
  kind: Kind | 'savings';
  categoryId: string | null;
  pattern: BudgetPattern;
  /** Amount typed by the person (per month, per year or per selected month, depending on pattern). */
  base: number;
  /** Always 12 values, January..December. Source of truth for every calculation. */
  amounts: number[];
}

export type Frequency = 'once' | 'monthly' | 'yearly';

export interface Recurring {
  id: string;
  name: string;
  type: Kind;
  amount: number | null;
  categoryId: string | null;
  accountId: string | null;
  frequency: Frequency;
  /** Every N months (monthly frequency only). */
  everyMonths: number;
  day: number;
  /** 1-12, yearly frequency only. */
  month: number | null;
  /** First date to consider (for `once`, the due date itself). */
  startDate: string;
  endDate: string | null;
  active: boolean;
}

export interface RecurringLog {
  id: string; // `${recurringId}::${period}`
  recurringId: string;
  period: string;
  status: 'done' | 'skipped';
  transactionId: string | null;
  at: string;
}

export interface Rule {
  id: string;
  pattern: string;
  categoryId: string;
  kind: Kind | null;
}

/** Personal preferences (one row per person, not shared with the household). */
export interface Settings {
  id: 'me';
  /** Active shared household (cloud only). */
  householdId: string | null;
  name: string;
  startMonth: string;
  theme: 'system' | 'light' | 'dark';
  onboarded: boolean;
  lastAccountId: string | null;
}

export interface Snapshot {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  budgetYears: BudgetYear[];
  budgetLines: BudgetLine[];
  recurring: Recurring[];
  recurringLog: RecurringLog[];
  rules: Rule[];
  settings: Settings[];
}
export type CollectionName = keyof Snapshot;

export interface Member { userId: string; role: 'owner' | 'member'; email: string | null; name: string }
export interface Household { id: string; name: string; members: Member[] }
export type Row<C extends CollectionName> = Snapshot[C][number];

export const EMPTY_SNAPSHOT: Snapshot = {
  accounts: [], categories: [], transactions: [], budgetYears: [], budgetLines: [],
  recurring: [], recurringLog: [], rules: [], settings: []
};

// ---------- import ----------

export interface BankRow {
  date: string;
  /** Signed: negative = money leaving the account. */
  amount: number;
  description: string;
  balance: number | null;
  externalId: string | null;
}

export interface ParsedStatement {
  rows: BankRow[];
  closingBalance: { date: string; amount: number } | null;
  accountHint: string | null;
}

export interface TableMapping {
  headerRow: number;
  date: number;
  description: number[];
  amount: number | null;
  debit: number | null;
  credit: number | null;
  balance: number | null;
  dateOrder: 'dmy' | 'mdy' | 'ymd';
  invert: boolean;
}
